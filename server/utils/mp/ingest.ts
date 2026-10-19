/**
 * Message ingestion: owner-supplied Messenger exports, parsed in the browser,
 * arrive here in chunks of normalized conversations.
 *
 * Dedupe never relies on message text alone. Facebook exports carry no
 * message id, so each message gets a fingerprint of conversation key,
 * sender, millisecond timestamp, a content hash, attachment URIs, and the
 * message's ordinal among otherwise identical events in that conversation.
 * Overlapping exports therefore produce the same fingerprints and are skipped.
 */
import { createHash, randomUUID } from "node:crypto";
import { and, desc, eq, inArray, isNull, max, min, sql } from "drizzle-orm";
import { db, schema } from "@nuxthub/db";
import { z } from "zod";
import { MESSAGE_SOURCES } from "#shared/miniprint/types";
import { getOwnerSettings } from "./settings";
import { requeueJob } from "./jobs";

const attachmentSchema = z.object({
  type: z.enum(["photo", "video", "audio", "file", "gif", "sticker", "share", "other"]),
  uri: z.string().max(1000).optional(),
  name: z.string().max(300).optional(),
  link: z.string().max(2000).optional(),
});

export const incomingMessageSchema = z.object({
  sourceMessageId: z.string().max(200).nullable(),
  senderName: z.string().min(1).max(200),
  timestampMs: z.number().int().min(946_684_800_000).max(4_102_444_800_000),
  text: z.string().max(20_000).nullable(),
  attachments: z.array(attachmentSchema).max(50),
  reactions: z.array(z.object({ actor: z.string().max(200), reaction: z.string().max(50) })).max(50),
  isUnsent: z.boolean(),
  /** Position among identical (sender, timestamp, content) events in the conversation. */
  ordinal: z.number().int().min(0).max(1000),
});

export const incomingConversationSchema = z.object({
  source: z.enum(MESSAGE_SOURCES),
  sourceKey: z.string().min(1).max(500),
  title: z.string().max(500).nullable(),
  participants: z.array(z.string().min(1).max(200)).max(300),
  isGroup: z.boolean(),
  folder: z.string().max(100).nullable(),
  messages: z.array(incomingMessageSchema).max(2000),
});

export type IncomingConversation = z.infer<typeof incomingConversationSchema>;

function sha(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export function messageFingerprint(sourceKey: string, m: z.infer<typeof incomingMessageSchema>) {
  const content = sha(m.text ?? "");
  const attachments = m.attachments.map(a => a.uri ?? a.link ?? a.type).join("\u0001");
  return sha([sourceKey, m.senderName, m.timestampMs, content, attachments, m.ordinal].join("\u0000"));
}

const nameKey = (name: string) => name.trim().toLowerCase();

async function upsertCollector(ownerId: string, displayName: string) {
  const [row] = await db.insert(schema.collectors)
    .values({ ownerId, displayName })
    .onConflictDoUpdate({
      target: [schema.collectors.ownerId, schema.collectors.displayName],
      set: { updatedAt: new Date() },
    })
    .returning({ id: schema.collectors.id });
  return row!.id;
}

export async function createImportBatch(ownerId: string, input: { source: typeof MESSAGE_SOURCES[number]; label?: string | null }) {
  const settings = await getOwnerSettings(ownerId);
  if (settings.messengerNames.length === 0) {
    throw createError({
      statusCode: 409,
      statusMessage: "Set the name(s) you appear under in Messenger before importing, so your own messages are told apart from collectors'.",
    });
  }
  const [batch] = await db.insert(schema.importBatches).values({
    ownerId,
    source: input.source,
    label: input.label ?? null,
  }).returning();
  return batch!;
}

async function requireBatch(ownerId: string, batchId: string) {
  const [batch] = await db.select().from(schema.importBatches)
    .where(and(eq(schema.importBatches.id, batchId), eq(schema.importBatches.ownerId, ownerId)))
    .limit(1);
  if (!batch) {
    throw createError({ statusCode: 404, statusMessage: "Import batch not found" });
  }
  if (batch.status !== "receiving") {
    throw createError({ statusCode: 409, statusMessage: `Import batch is ${batch.status}` });
  }
  return batch;
}

export async function addConversationsToBatch(ownerId: string, batchId: string, incoming: IncomingConversation[]) {
  const batch = await requireBatch(ownerId, batchId);
  const settings = await getOwnerSettings(ownerId);
  const ownerNames = new Set(settings.messengerNames.map(nameKey));
  const warnings: string[] = [];
  let received = 0;
  let inserted = 0;

  for (const conv of incoming) {
    if (conv.source !== batch.source && conv.source !== "manual_entry") {
      warnings.push(`Skipped a ${conv.source} conversation sent to a ${batch.source} batch.`);
      continue;
    }

    const others = conv.participants.filter(p => !ownerNames.has(nameKey(p)));
    const oneToOne = !conv.isGroup && others.length === 1;
    const collectorId = oneToOne ? await upsertCollector(ownerId, others[0]!) : null;

    const [existing] = await db.select().from(schema.conversations)
      .where(and(eq(schema.conversations.ownerId, ownerId), eq(schema.conversations.sourceKey, conv.sourceKey)))
      .limit(1);

    let conversationId: string;
    if (existing) {
      conversationId = existing.id;
      const participants = [...new Set([...existing.participants, ...conv.participants])];
      await db.update(schema.conversations).set({
        participants,
        title: existing.title ?? conv.title,
        isGroup: participants.length > 2,
        collectorId: existing.collectorId ?? collectorId,
      }).where(eq(schema.conversations.id, existing.id));
    }
    else {
      const [created] = await db.insert(schema.conversations).values({
        ownerId,
        sourceKey: conv.sourceKey,
        title: conv.title,
        participants: conv.participants,
        isGroup: conv.isGroup,
        collectorId,
      }).returning({ id: schema.conversations.id });
      conversationId = created!.id;
    }

    const senderCollectors = new Map<string, string | null>();
    for (const m of conv.messages) {
      const key = nameKey(m.senderName);
      if (!senderCollectors.has(key)) {
        senderCollectors.set(key, ownerNames.has(key) ? null : oneToOne && key === nameKey(others[0]!) ? collectorId : await upsertCollector(ownerId, m.senderName));
      }
    }

    const rows = conv.messages.map(m => ({
      ownerId,
      conversationId,
      sourceMessageId: m.sourceMessageId,
      fingerprint: messageFingerprint(conv.sourceKey, m),
      senderName: m.senderName,
      senderIsOwner: ownerNames.has(nameKey(m.senderName)),
      collectorId: senderCollectors.get(nameKey(m.senderName)) ?? null,
      sentAt: new Date(m.timestampMs),
      timestampMs: m.timestampMs,
      text: m.text,
      attachments: m.attachments,
      reactions: m.reactions,
      isUnsent: m.isUnsent,
      ingestionSource: conv.source,
      importBatchId: batchId,
      processingStatus: "pending",
    }));
    received += rows.length;

    for (let i = 0; i < rows.length; i += 500) {
      const result = await db.insert(schema.messages)
        .values(rows.slice(i, i + 500))
        .onConflictDoNothing()
        .returning({ id: schema.messages.id });
      inserted += result.length;
    }
  }

  await db.update(schema.importBatches).set({
    messagesReceived: sql`${schema.importBatches.messagesReceived} + ${received}`,
    messagesInserted: sql`${schema.importBatches.messagesInserted} + ${inserted}`,
    duplicatesSkipped: sql`${schema.importBatches.duplicatesSkipped} + ${received - inserted}`,
    warnings: warnings.length > 0 ? sql`${schema.importBatches.warnings} || ${JSON.stringify(warnings)}::jsonb` : undefined,
  }).where(eq(schema.importBatches.id, batchId));

  return { received, inserted, duplicates: received - inserted, warnings };
}

export async function completeImportBatch(ownerId: string, batchId: string, clientWarnings: string[] = []) {
  const batch = await requireBatch(ownerId, batchId);

  const [range] = await db.select({
    earliest: min(schema.messages.timestampMs),
    latest: max(schema.messages.timestampMs),
  }).from(schema.messages).where(eq(schema.messages.importBatchId, batchId));

  // Conversations this batch added messages to.
  const touched = await db.select({
    conversationId: schema.messages.conversationId,
    earliest: min(schema.messages.timestampMs),
  }).from(schema.messages)
    .where(eq(schema.messages.importBatchId, batchId))
    .groupBy(schema.messages.conversationId);

  // Gap: this batch's first new message comes after everything previously
  // stored, with nothing from this batch overlapping it. Messages between the
  // two may be missing (e.g. a date-limited export).
  for (const t of touched) {
    const [before] = await db.select({ latest: max(schema.messages.timestampMs) })
      .from(schema.messages)
      .where(and(
        eq(schema.messages.conversationId, t.conversationId),
        sql`${schema.messages.importBatchId} is distinct from ${batchId}`,
        sql`${schema.messages.timestampMs} < ${t.earliest}`,
      ));
    const [overlap] = await db.select({ n: sql<number>`count(*)::int` })
      .from(schema.messages)
      .where(and(
        eq(schema.messages.conversationId, t.conversationId),
        sql`${schema.messages.importBatchId} is distinct from ${batchId}`,
        sql`${schema.messages.timestampMs} >= ${t.earliest}`,
      ));
    if (before?.latest && (overlap?.n ?? 0) === 0 && t.earliest! - before.latest > 24 * 60 * 60 * 1000) {
      await db.insert(schema.ingestionGaps).values({
        ownerId,
        conversationId: t.conversationId,
        kind: "between_imports",
        description: "No messages were imported between the end of the earlier data and the start of this import. Messages from that period may be missing.",
        gapStart: new Date(before.latest),
        gapEnd: new Date(t.earliest!),
        importBatchId: batchId,
      });
    }
  }

  if (batch.source === "fb_dyi_json") {
    const [e2ee] = await db.select({ id: schema.importBatches.id }).from(schema.importBatches)
      .where(and(eq(schema.importBatches.ownerId, ownerId), eq(schema.importBatches.source, "fb_e2ee_json"), eq(schema.importBatches.status, "succeeded")))
      .limit(1);
    const [openGap] = await db.select({ id: schema.ingestionGaps.id }).from(schema.ingestionGaps)
      .where(and(eq(schema.ingestionGaps.ownerId, ownerId), eq(schema.ingestionGaps.kind, "e2ee_not_imported"), isNull(schema.ingestionGaps.resolvedAt)))
      .limit(1);
    if (!e2ee && !openGap) {
      await db.insert(schema.ingestionGaps).values({
        ownerId,
        kind: "e2ee_not_imported",
        description: "End-to-end encrypted Messenger chats are not included in “Export your information”. Download them separately from Messenger → Privacy & safety → End-to-end encrypted chats → Message storage, then import that file.",
        importBatchId: batchId,
      });
    }
  }
  if (batch.source === "fb_e2ee_json") {
    await db.update(schema.ingestionGaps).set({ resolvedAt: new Date() })
      .where(and(eq(schema.ingestionGaps.ownerId, ownerId), eq(schema.ingestionGaps.kind, "e2ee_not_imported"), isNull(schema.ingestionGaps.resolvedAt)));
  }

  await db.update(schema.importBatches).set({
    status: "succeeded",
    finishedAt: new Date(),
    earliestMessageAt: range?.earliest ? new Date(range.earliest) : null,
    latestMessageAt: range?.latest ? new Date(range.latest) : null,
    warnings: clientWarnings.length > 0 ? sql`${schema.importBatches.warnings} || ${JSON.stringify(clientWarnings.slice(0, 200))}::jsonb` : undefined,
  }).where(eq(schema.importBatches.id, batchId));

  for (const t of touched) {
    await requeueJob({
      kind: "conversation_analyze",
      idempotencyKey: `analyze:${t.conversationId}`,
      ownerId,
      payload: { conversationId: t.conversationId },
    });
  }

  const [done] = await db.select().from(schema.importBatches).where(eq(schema.importBatches.id, batchId));
  return { batch: done!, conversationsQueued: touched.length };
}

export async function failImportBatch(ownerId: string, batchId: string, reason: string) {
  await db.update(schema.importBatches).set({
    status: "failed",
    finishedAt: new Date(),
    warnings: sql`${schema.importBatches.warnings} || ${JSON.stringify([reason.slice(0, 300)])}::jsonb`,
  }).where(and(eq(schema.importBatches.id, batchId), eq(schema.importBatches.ownerId, ownerId)));
}

/** One message typed or pasted by the owner — the incremental path when no live source exists. */
export async function addManualMessage(ownerId: string, input: {
  collectorName: string;
  fromOwner: boolean;
  sentAt: Date;
  text: string;
}) {
  const settings = await getOwnerSettings(ownerId);
  const ownerName = settings.messengerNames[0];
  if (!ownerName) {
    throw createError({ statusCode: 409, statusMessage: "Set your Messenger name first." });
  }

  // Attach to the collector's existing one-to-one conversation when there is one.
  const collectorId = await upsertCollector(ownerId, input.collectorName.trim());
  const [conv] = await db.select().from(schema.conversations)
    .where(and(eq(schema.conversations.ownerId, ownerId), eq(schema.conversations.collectorId, collectorId), eq(schema.conversations.isGroup, false)))
    .orderBy(desc(schema.conversations.updatedAt))
    .limit(1);

  const batch = await createImportBatch(ownerId, { source: "manual_entry", label: "Manual entry" });
  const conversation: IncomingConversation = {
    source: "manual_entry",
    sourceKey: conv?.sourceKey ?? `manual:${collectorId}`,
    title: conv?.title ?? input.collectorName,
    participants: [ownerName, input.collectorName.trim()],
    isGroup: false,
    folder: null,
    messages: [{
      sourceMessageId: `manual:${randomUUID()}`,
      senderName: input.fromOwner ? ownerName : input.collectorName.trim(),
      timestampMs: input.sentAt.getTime(),
      text: input.text,
      attachments: [],
      reactions: [],
      isUnsent: false,
      ordinal: 0,
    }],
  };
  await addConversationsToBatch(ownerId, batch.id, [conversation]);
  return completeImportBatch(ownerId, batch.id);
}

export async function getIngestionStatus(ownerId: string) {
  const batches = await db.select().from(schema.importBatches)
    .where(eq(schema.importBatches.ownerId, ownerId))
    .orderBy(desc(schema.importBatches.startedAt))
    .limit(20);
  const lastSuccess = batches.find(b => b.status === "succeeded");

  const bySource = await db.select({
    source: schema.importBatches.source,
    lastSuccessAt: max(schema.importBatches.finishedAt),
    latestMessageAt: max(schema.importBatches.latestMessageAt),
  }).from(schema.importBatches)
    .where(and(eq(schema.importBatches.ownerId, ownerId), eq(schema.importBatches.status, "succeeded")))
    .groupBy(schema.importBatches.source);

  const gaps = await db.select().from(schema.ingestionGaps)
    .where(and(eq(schema.ingestionGaps.ownerId, ownerId), isNull(schema.ingestionGaps.resolvedAt)))
    .orderBy(desc(schema.ingestionGaps.createdAt))
    .limit(100);

  const [counts] = await db.select({
    total: sql<number>`count(*)::int`,
    pending: sql<number>`count(*) filter (where ${schema.messages.processingStatus} = 'pending')::int`,
    failed: sql<number>`count(*) filter (where ${schema.messages.processingStatus} = 'failed')::int`,
  }).from(schema.messages).where(eq(schema.messages.ownerId, ownerId));

  const jobs = await db.select({
    kind: schema.analysisJobs.kind,
    status: schema.analysisJobs.status,
    n: sql<number>`count(*)::int`,
  }).from(schema.analysisJobs)
    .where(sql`(${schema.analysisJobs.ownerId} = ${ownerId} or ${schema.analysisJobs.ownerId} is null)`)
    .groupBy(schema.analysisJobs.kind, schema.analysisJobs.status);

  const recentErrors = await db.select({
    id: schema.analysisJobs.id,
    kind: schema.analysisJobs.kind,
    status: schema.analysisJobs.status,
    attempts: schema.analysisJobs.attempts,
    lastError: schema.analysisJobs.lastError,
    updatedAt: schema.analysisJobs.updatedAt,
  }).from(schema.analysisJobs)
    .where(and(
      sql`(${schema.analysisJobs.ownerId} = ${ownerId} or ${schema.analysisJobs.ownerId} is null)`,
      inArray(schema.analysisJobs.status, ["failed", "dead"]),
    ))
    .orderBy(desc(schema.analysisJobs.updatedAt))
    .limit(20);

  return {
    // No authorized live source for a personal Messenger inbox exists, so this
    // is never "connected"; data is only as current as the latest import.
    liveSource: {
      connected: false,
      description: "No live Messenger source is connected. Meta offers no supported API for reading a personal inbox, so messages arrive only through exports you import or messages you enter manually.",
    },
    lastSuccessfulIngestionAt: lastSuccess?.finishedAt?.toISOString() ?? null,
    sources: bySource.map(s => ({
      source: s.source,
      lastSuccessAt: s.lastSuccessAt?.toISOString() ?? null,
      latestMessageAt: s.latestMessageAt?.toISOString() ?? null,
    })),
    recentBatches: batches.map(b => ({
      id: b.id,
      source: b.source,
      label: b.label,
      status: b.status,
      messagesReceived: b.messagesReceived,
      messagesInserted: b.messagesInserted,
      duplicatesSkipped: b.duplicatesSkipped,
      earliestMessageAt: b.earliestMessageAt?.toISOString() ?? null,
      latestMessageAt: b.latestMessageAt?.toISOString() ?? null,
      warnings: b.warnings.slice(0, 20),
      startedAt: b.startedAt.toISOString(),
      finishedAt: b.finishedAt?.toISOString() ?? null,
    })),
    knownGaps: gaps.map(g => ({
      id: g.id,
      kind: g.kind,
      description: g.description,
      conversationId: g.conversationId,
      gapStart: g.gapStart?.toISOString() ?? null,
      gapEnd: g.gapEnd?.toISOString() ?? null,
    })),
    messages: counts ?? { total: 0, pending: 0, failed: 0 },
    jobs,
    recentErrors: recentErrors.map(e => ({ ...e, updatedAt: e.updatedAt.toISOString() })),
  };
}
