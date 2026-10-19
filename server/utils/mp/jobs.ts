/**
 * Durable background jobs backed by Postgres.
 *
 * - Enqueue is idempotent: the same `idempotencyKey` never creates two jobs.
 * - Claiming uses `FOR UPDATE SKIP LOCKED` plus a lease, so overlapping
 *   runners never process the same job, and a crashed runner's job becomes
 *   claimable again when its lease expires.
 * - Failures retry with exponential backoff, then park as `dead` for review.
 *
 * The runner is driven by the eve schedule `agent/schedules/jobs.ts` (every
 * minute) through `/api/internal/mp/jobs/run`, and on demand from the
 * dashboard.
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import { db, schema } from "@nuxthub/db";

export type JobKind =
  | "catalog_sync"
  | "catalog_verify_batch"
  | "inventory_identify"
  | "conversation_analyze";

export type Job = typeof schema.analysisJobs.$inferSelect;

export interface JobContext {
  /** Epoch ms after which handlers should stop starting new work. */
  deadline: number;
  enqueue: typeof enqueueJob;
}

export type JobHandler = (job: Job, ctx: JobContext) => Promise<Record<string, unknown> | undefined>;

/** A handler can throw this to requeue itself without counting a failed attempt. */
export class JobContinuation extends Error {
  constructor(public payload: Record<string, unknown>) {
    super("continue");
  }
}

const LEASE_MS = 5 * 60_000;

export async function enqueueJob(input: {
  kind: JobKind;
  idempotencyKey: string;
  ownerId?: string | null;
  payload?: Record<string, unknown>;
  runAfter?: Date;
  maxAttempts?: number;
}) {
  const [row] = await db.insert(schema.analysisJobs).values({
    kind: input.kind,
    idempotencyKey: input.idempotencyKey,
    ownerId: input.ownerId ?? null,
    payload: input.payload ?? {},
    runAfter: input.runAfter ?? new Date(),
    maxAttempts: input.maxAttempts ?? 5,
  }).onConflictDoNothing({ target: schema.analysisJobs.idempotencyKey }).returning({ id: schema.analysisJobs.id });
  return { created: !!row, id: row?.id ?? null };
}

/**
 * Re-arm a finished job under the same key (e.g. new messages arrived for a
 * conversation whose analysis already ran). A queued or running job is left alone.
 */
export async function requeueJob(input: { kind: JobKind; idempotencyKey: string; ownerId?: string | null; payload?: Record<string, unknown> }) {
  const created = await enqueueJob(input);
  if (created.created) {
    return created;
  }
  await db.update(schema.analysisJobs).set({
    status: "queued",
    attempts: 0,
    runAfter: new Date(),
    lastError: null,
    payload: input.payload ?? {},
    finishedAt: null,
  }).where(and(
    eq(schema.analysisJobs.idempotencyKey, input.idempotencyKey),
    sql`${schema.analysisJobs.status} in ('succeeded', 'failed', 'dead')`,
  ));
  return { created: false, id: null };
}

async function claim(limit: number, ownerId?: string): Promise<Job[]> {
  const ownerFilter = ownerId
    ? sql`and (owner_id = ${ownerId} or owner_id is null)`
    : sql``;
  const result = await db.execute(sql`
    update mp_analysis_jobs set
      status = 'running',
      attempts = attempts + 1,
      lease_until = now() + (${LEASE_MS} * interval '1 millisecond'),
      updated_at = now()
    where id in (
      select id from mp_analysis_jobs
      where (
        (status in ('queued', 'failed') and run_after <= now())
        or (status = 'running' and lease_until < now())
      ) ${ownerFilter}
      order by run_after
      limit ${limit}
      for update skip locked
    )
    returning id
  `);
  const ids = (result as unknown as Array<{ id: string }>).map(r => r.id);
  if (ids.length === 0) {
    return [];
  }
  return db.select().from(schema.analysisJobs).where(inArray(schema.analysisJobs.id, ids));
}

function backoffMs(attempt: number) {
  return Math.min(60 * 60_000, 30_000 * 2 ** (attempt - 1));
}

/** Errors are stored for the health view; keep them short and free of message content. */
function safeError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message.slice(0, 500);
}

export async function runDueJobs(
  handlers: Record<JobKind, JobHandler>,
  options: { budgetMs?: number; ownerId?: string } = {},
) {
  const deadline = Date.now() + (options.budgetMs ?? 45_000);
  const summary = { ran: 0, succeeded: 0, failed: 0, continued: 0 };

  while (Date.now() < deadline - 5_000) {
    const [job] = await claim(1, options.ownerId);
    if (!job) {
      break;
    }
    summary.ran++;
    const handler = handlers[job.kind as JobKind];
    try {
      if (!handler) {
        throw new Error(`No handler for job kind ${job.kind}`);
      }
      const result = await handler(job, { deadline, enqueue: enqueueJob });
      await db.update(schema.analysisJobs).set({
        status: "succeeded",
        result: result ?? null,
        lastError: null,
        leaseUntil: null,
        finishedAt: new Date(),
      }).where(eq(schema.analysisJobs.id, job.id));
      summary.succeeded++;
    }
    catch (error) {
      if (error instanceof JobContinuation) {
        await db.update(schema.analysisJobs).set({
          status: "queued",
          attempts: sql`greatest(${schema.analysisJobs.attempts} - 1, 0)`,
          payload: error.payload,
          leaseUntil: null,
          runAfter: new Date(),
        }).where(eq(schema.analysisJobs.id, job.id));
        summary.continued++;
        continue;
      }
      const dead = job.attempts >= job.maxAttempts;
      await db.update(schema.analysisJobs).set({
        status: dead ? "dead" : "failed",
        lastError: safeError(error),
        leaseUntil: null,
        runAfter: new Date(Date.now() + backoffMs(job.attempts)),
        finishedAt: dead ? new Date() : null,
      }).where(eq(schema.analysisJobs.id, job.id));
      summary.failed++;
      console.error(`[mp-jobs] ${job.kind} ${job.id} attempt ${job.attempts} failed: ${safeError(error)}`);
    }
  }
  return summary;
}

export async function retryJob(jobId: string, ownerId: string) {
  await db.update(schema.analysisJobs).set({
    status: "queued",
    attempts: 0,
    runAfter: new Date(),
    lastError: null,
    finishedAt: null,
  }).where(and(
    eq(schema.analysisJobs.id, jobId),
    sql`(${schema.analysisJobs.ownerId} = ${ownerId} or ${schema.analysisJobs.ownerId} is null)`,
    sql`${schema.analysisJobs.status} in ('failed', 'dead')`,
  ));
}
