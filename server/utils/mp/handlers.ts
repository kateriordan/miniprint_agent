import { and, eq, sql } from "drizzle-orm";
import { db, schema } from "@nuxthub/db";
import { analyzeConversationJob } from "./analysis";
import { finishSyncRunIfDone, startCatalogSync, verifyCatalogUrls } from "./catalog";
import { identifyUploadJob } from "./inventory";
import { JobContinuation, enqueueJob, runDueJobs } from "./jobs";
import type { JobHandler, JobKind } from "./jobs";

const handlers: Record<JobKind, JobHandler> = {
  async catalog_sync() {
    // One full sync at a time: a weekly refresh and a manual request can coincide.
    const [active] = await db.select({ id: schema.catalogSyncRuns.id }).from(schema.catalogSyncRuns)
      .where(sql`${schema.catalogSyncRuns.status} in ('running', 'verifying') and ${schema.catalogSyncRuns.startedAt} > now() - interval '3 hours'`)
      .limit(1);
    if (active) {
      return { skipped: `sync run ${active.id} is already in progress` };
    }
    return startCatalogSync(async (urls, runId, index) => {
      await enqueueJob({
        kind: "catalog_verify_batch",
        idempotencyKey: `catalog-verify:${runId}:${index}`,
        payload: { urls, runId },
      });
    });
  },

  async catalog_verify_batch(job, ctx) {
    const urls = (job.payload.urls as string[]) ?? [];
    const runId = typeof job.payload.runId === "number" ? job.payload.runId : null;
    const result = await verifyCatalogUrls(urls, runId, ctx.deadline - 3_000);
    if (result.remaining.length > 0) {
      throw new JobContinuation({ ...job.payload, urls: result.remaining });
    }
    if (runId !== null) {
      const [pending] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.analysisJobs)
        .where(and(
          eq(schema.analysisJobs.kind, "catalog_verify_batch"),
          sql`${schema.analysisJobs.payload}->>'runId' = ${String(runId)}`,
          sql`${schema.analysisJobs.status} in ('queued', 'running', 'failed')`,
          sql`${schema.analysisJobs.id} <> ${job.id}`,
        ));
      await finishSyncRunIfDone(runId, pending?.n ?? 0);
    }
    return { verified: result.verified, errors: result.errors.slice(0, 10) };
  },

  inventory_identify: job => identifyUploadJob(job),
  conversation_analyze: (job, ctx) => analyzeConversationJob(job, ctx),
};

export function runJobs(options: { budgetMs?: number; ownerId?: string } = {}) {
  return runDueJobs(handlers, options);
}

/** Weekly full refresh, queued once per ISO week. */
export async function ensureCatalogRefreshScheduled() {
  const now = new Date();
  const week = `${now.getUTCFullYear()}-${Math.floor((now.getTime() - Date.UTC(now.getUTCFullYear(), 0, 1)) / (7 * 86_400_000))}`;
  await enqueueJob({ kind: "catalog_sync", idempotencyKey: `catalog-sync:week:${week}`, maxAttempts: 3 });
}

export async function requestCatalogSync() {
  return enqueueJob({ kind: "catalog_sync", idempotencyKey: `catalog-sync:manual:${Date.now()}`, maxAttempts: 3 });
}
