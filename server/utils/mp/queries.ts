import { and, asc, desc, eq, gte, ilike, inArray, lte, or, sql } from "drizzle-orm";
import { db, schema } from "@nuxthub/db";
import { matchPrintName, normalizeName } from "#shared/miniprint/match";
import { OPEN_STATUSES } from "#shared/miniprint/types";
import { getMatchableCatalog, toCatalogFact } from "./catalog";

const messageColumns = {
  id: schema.messages.id,
  conversationId: schema.messages.conversationId,
  senderName: schema.messages.senderName,
  senderIsOwner: schema.messages.senderIsOwner,
  sentAt: schema.messages.sentAt,
  text: schema.messages.text,
  attachments: schema.messages.attachments,
  ingestionSource: schema.messages.ingestionSource,
};

function serializeMessage(m: { sentAt: Date; [k: string]: unknown }) {
  return { ...m, sentAt: m.sentAt.toISOString() };
}

export async function searchMessages(ownerId: string, input: {
  query?: string;
  collectorId?: string;
  conversationId?: string;
  since?: string;
  until?: string;
  limit?: number;
}) {
  const conditions = [eq(schema.messages.ownerId, ownerId)];
  if (input.query?.trim()) {
    const q = input.query.trim();
    conditions.push(or(
      sql`${schema.messages.search} @@ websearch_to_tsquery('simple', ${q})`,
      ilike(schema.messages.text, `%${q.replace(/[%_\\]/g, "\\$&")}%`),
    )!);
  }
  if (input.collectorId) {
    conditions.push(or(
      eq(schema.messages.collectorId, input.collectorId),
      inArray(schema.messages.conversationId, db.select({ id: schema.conversations.id }).from(schema.conversations).where(eq(schema.conversations.collectorId, input.collectorId))),
    )!);
  }
  if (input.conversationId) {
    conditions.push(eq(schema.messages.conversationId, input.conversationId));
  }
  if (input.since) {
    conditions.push(gte(schema.messages.sentAt, new Date(input.since)));
  }
  if (input.until) {
    conditions.push(lte(schema.messages.sentAt, new Date(input.until)));
  }
  const rows = await db.select(messageColumns).from(schema.messages)
    .where(and(...conditions))
    .orderBy(desc(schema.messages.timestampMs))
    .limit(Math.min(input.limit ?? 25, 100));
  return rows.map(serializeMessage);
}

export async function getConversationContext(ownerId: string, input: { messageId?: string; conversationId?: string; before?: number; after?: number }) {
  let conversationId = input.conversationId;
  let anchorTs: number | null = null;
  if (input.messageId) {
    const [anchor] = await db.select({ conversationId: schema.messages.conversationId, ts: schema.messages.timestampMs })
      .from(schema.messages)
      .where(and(eq(schema.messages.id, input.messageId), eq(schema.messages.ownerId, ownerId)));
    if (!anchor) {
      throw createError({ statusCode: 404, statusMessage: "Message not found" });
    }
    conversationId = anchor.conversationId;
    anchorTs = anchor.ts;
  }
  if (!conversationId) {
    throw createError({ statusCode: 400, statusMessage: "messageId or conversationId is required" });
  }
  const [conversation] = await db.select().from(schema.conversations)
    .where(and(eq(schema.conversations.id, conversationId), eq(schema.conversations.ownerId, ownerId)));
  if (!conversation) {
    throw createError({ statusCode: 404, statusMessage: "Conversation not found" });
  }
  const before = Math.min(input.before ?? 15, 60);
  const after = Math.min(input.after ?? 15, 60);
  const base = eq(schema.messages.conversationId, conversationId);
  const earlier = anchorTs === null
    ? (await db.select(messageColumns).from(schema.messages).where(base).orderBy(desc(schema.messages.timestampMs)).limit(before + after)).reverse()
    : (await db.select(messageColumns).from(schema.messages)
        .where(and(base, sql`${schema.messages.timestampMs} <= ${anchorTs}`))
        .orderBy(desc(schema.messages.timestampMs)).limit(before + 1)).reverse();
  const later = anchorTs === null
    ? []
    : await db.select(messageColumns).from(schema.messages)
        .where(and(base, sql`${schema.messages.timestampMs} > ${anchorTs}`))
        .orderBy(asc(schema.messages.timestampMs)).limit(after);
  return {
    conversation: { id: conversation.id, title: conversation.title, participants: conversation.participants, isGroup: conversation.isGroup },
    messages: [...earlier, ...later].map(serializeMessage),
  };
}

export async function listCollectors(ownerId: string, query?: string) {
  return db.select({
    id: schema.collectors.id,
    displayName: schema.collectors.displayName,
    messageCount: sql<number>`(select count(*)::int from mp_messages m where m.collector_id = "mp_collectors"."id")`,
    tradeCount: sql<number>`(select count(*)::int from mp_trades t where t.collector_id = "mp_collectors"."id")`,
    openTradeCount: sql<number>`(select count(*)::int from mp_trades t where t.collector_id = "mp_collectors"."id" and t.trade_status in ${OPEN_STATUSES})`,
    lastMessageAt: sql<string | null>`(select to_json(max(m.sent_at)) #>> '{}' from mp_messages m where m.collector_id = "mp_collectors"."id")`,
  }).from(schema.collectors)
    .where(and(eq(schema.collectors.ownerId, ownerId), query ? ilike(schema.collectors.displayName, `%${query}%`) : undefined))
    .orderBy(asc(schema.collectors.displayName));
}

export async function resolveCollector(ownerId: string, input: { collectorId?: string; name?: string }) {
  if (input.collectorId) {
    const [c] = await db.select().from(schema.collectors)
      .where(and(eq(schema.collectors.id, input.collectorId), eq(schema.collectors.ownerId, ownerId)));
    return c ? [c] : [];
  }
  if (input.name) {
    return db.select().from(schema.collectors)
      .where(and(eq(schema.collectors.ownerId, ownerId), ilike(schema.collectors.displayName, `%${input.name}%`)))
      .limit(10);
  }
  return [];
}

export async function getCollectorHistory(ownerId: string, collectorId: string) {
  const [collector] = await resolveCollector(ownerId, { collectorId });
  if (!collector) {
    throw createError({ statusCode: 404, statusMessage: "Collector not found" });
  }
  const conversations = await db.select({
    id: schema.conversations.id,
    title: schema.conversations.title,
    sourceKey: schema.conversations.sourceKey,
    isGroup: schema.conversations.isGroup,
    messageCount: sql<number>`(select count(*)::int from mp_messages m where m.conversation_id = "mp_conversations"."id")`,
    firstMessageAt: sql<string | null>`(select to_json(min(m.sent_at)) #>> '{}' from mp_messages m where m.conversation_id = "mp_conversations"."id")`,
    lastMessageAt: sql<string | null>`(select to_json(max(m.sent_at)) #>> '{}' from mp_messages m where m.conversation_id = "mp_conversations"."id")`,
  }).from(schema.conversations)
    .where(and(
      eq(schema.conversations.ownerId, ownerId),
      or(
        eq(schema.conversations.collectorId, collectorId),
        sql`exists (select 1 from mp_messages m where m.conversation_id = "mp_conversations"."id" and m.collector_id = ${collectorId})`,
      ),
    ));
  const trades = await db.select().from(schema.trades)
    .where(and(eq(schema.trades.ownerId, ownerId), eq(schema.trades.collectorId, collectorId)))
    .orderBy(desc(schema.trades.lastUpdatedAt));
  const preferences = await db.select().from(schema.collectorPreferences)
    .where(and(eq(schema.collectorPreferences.ownerId, ownerId), eq(schema.collectorPreferences.collectorId, collectorId)))
    .orderBy(desc(schema.collectorPreferences.createdAt));
  const revisions = trades.length > 0
    ? await db.select().from(schema.tradeRevisions)
        .where(inArray(schema.tradeRevisions.tradeId, trades.map(t => t.tradeId)))
        .orderBy(asc(schema.tradeRevisions.createdAt))
    : [];
  return { collector, conversations, trades, revisions, preferences };
}

export async function searchPrintCatalog(input: { query: string; artist?: string; limit?: number }) {
  const catalog = await getMatchableCatalog();
  const match = matchPrintName(input.query, catalog, { artist: input.artist });
  const q = normalizeName(input.query);
  const tokens = q.split(" ").filter(t => t.length > 1);
  const textHits = catalog
    .filter(c => tokens.length > 0 && tokens.every(t => normalizeName(`${c.canonicalName} ${c.artist}`).includes(t)))
    .slice(0, input.limit ?? 15)
    .map(c => c.printId);
  const ids = [...new Set([...match.candidates, ...textHits])].slice(0, input.limit ?? 15);
  const rows = ids.length > 0
    ? await db.select().from(schema.catalogPrints).where(inArray(schema.catalogPrints.printId, ids))
    : [];
  const byId = new Map(rows.map(r => [r.printId, toCatalogFact(r)]));
  return {
    match: { status: match.status, printId: match.printId, reason: match.reason },
    results: ids.map(id => byId.get(id)).filter(Boolean),
    catalogSize: catalog.length,
  };
}

export async function getPrint(printId: string) {
  const [row] = await db.select().from(schema.catalogPrints).where(eq(schema.catalogPrints.printId, printId));
  return row ? toCatalogFact(row) : null;
}

export async function getCatalogReview() {
  const [counts] = await db.select({
    total: sql<number>`count(*)::int`,
    verified: sql<number>`count(*) filter (where verification_status = 'verified')::int`,
    rarityMissing: sql<number>`count(*) filter (where verification_status = 'rarity_missing')::int`,
    missingFromSource: sql<number>`count(*) filter (where verification_status = 'missing_from_source')::int`,
    conflict: sql<number>`count(*) filter (where verification_status = 'conflict')::int`,
    stale: sql<number>`count(*) filter (where verified_at < now() - interval '7 days')::int`,
  }).from(schema.catalogPrints);
  const problems = await db.select().from(schema.catalogPrints)
    .where(sql`verification_status <> 'verified' or verified_at is null or verified_at < now() - interval '7 days'`)
    .orderBy(asc(schema.catalogPrints.canonicalName))
    .limit(200);
  const runs = await db.select().from(schema.catalogSyncRuns).orderBy(desc(schema.catalogSyncRuns.startedAt)).limit(10);
  return { counts, problems: problems.map(toCatalogFact), runs };
}

export async function getUnresolvedTradeLines(ownerId: string) {
  const rows = await db.select({
    tradeId: schema.trades.tradeId,
    status: schema.trades.tradeStatus,
    printsRequested: schema.trades.printsRequested,
    printsOffered: schema.trades.printsOffered,
    collectorName: schema.collectors.displayName,
  }).from(schema.trades)
    .leftJoin(schema.collectors, eq(schema.collectors.id, schema.trades.collectorId))
    .where(eq(schema.trades.ownerId, ownerId));
  return rows.flatMap(r => [...r.printsRequested, ...r.printsOffered]
    .filter(l => l.matchStatus !== "verified")
    .map(l => ({ tradeId: r.tradeId, status: r.status, collectorName: r.collectorName, ...l })));
}
