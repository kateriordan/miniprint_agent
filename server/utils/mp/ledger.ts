/**
 * Trade ledger. Every change appends a revision; the trade row is the
 * current view. Two rules are enforced here, not in prompts:
 *
 * 1. AI-recorded changes can only set AI_SETTABLE_STATUSES. When the
 *    messages suggest a commitment or terminal status (accepted, completed,
 *    declined, cancelled, expired), it is stored as `proposedStatus` for the
 *    owner to confirm.
 * 2. Inventory never changes because of an offer or a recommendation. It
 *    changes only when the owner confirms a completed trade and chooses to
 *    apply it.
 */
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db, schema } from "@nuxthub/db";
import { matchPrintName } from "#shared/miniprint/match";
import { AI_SETTABLE_STATUSES, OPEN_STATUSES } from "#shared/miniprint/types";
import type { TradeLine, TradeStatus } from "#shared/miniprint/types";
import { getMatchableCatalog } from "./catalog";

export type Trade = typeof schema.trades.$inferSelect;
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export async function resolveLines(lines: Array<{ label: string; quantity: number | null; printId?: string | null }>): Promise<TradeLine[]> {
  const catalog = await getMatchableCatalog();
  const known = new Set(catalog.map(c => c.printId));
  return lines.map((line) => {
    if (line.printId && known.has(line.printId)) {
      return { label: line.label, printId: line.printId, candidatePrintIds: [line.printId], matchStatus: "verified", quantity: line.quantity };
    }
    const match = matchPrintName(line.label, catalog);
    return {
      label: line.label,
      printId: match.printId,
      candidatePrintIds: match.candidates,
      matchStatus: match.status,
      quantity: line.quantity,
    };
  });
}

interface RevisionInput {
  kind: "new_offer" | "counteroffer" | "modification" | "status_change" | "owner_correction" | "note";
  status?: TradeStatus;
  printsRequested?: TradeLine[];
  printsOffered?: TradeLine[];
  sourceMessageIds?: string[];
  actor?: "collector" | "owner" | "unknown";
  recordedBy: "ai" | "owner";
  interpretation?: string | null;
  confidence?: string | null;
  quote?: string | null;
  quoteVerified?: boolean;
  eventKey?: string | null;
  decisionNotes?: string | null;
  /** When the triggering message was sent; defaults to now. */
  occurredAt?: Date;
}

function isAiSettable(status: TradeStatus) {
  return (AI_SETTABLE_STATUSES as readonly string[]).includes(status);
}

function anyUnresolved(lines: TradeLine[]) {
  return lines.some(l => l.matchStatus !== "verified");
}

export async function createTrade(ownerId: string, input: RevisionInput & {
  conversationId: string;
  collectorId: string | null;
  printsRequested: TradeLine[];
  printsOffered: TradeLine[];
}) {
  return db.transaction(async (tx) => {
    if (input.eventKey) {
      const [seen] = await tx.select({ tradeId: schema.tradeRevisions.tradeId }).from(schema.tradeRevisions)
        .where(eq(schema.tradeRevisions.eventKey, input.eventKey)).limit(1);
      if (seen) {
        return { tradeId: seen.tradeId, duplicate: true };
      }
    }
    let status: TradeStatus = input.status ?? "new_offer";
    let proposedStatus: TradeStatus | null = null;
    if (input.recordedBy === "ai" && !isAiSettable(status)) {
      proposedStatus = status;
      status = "under_review";
    }
    if (status === "new_offer" && (anyUnresolved(input.printsRequested) || anyUnresolved(input.printsOffered))) {
      status = "needs_clarification";
    }
    const at = input.occurredAt ?? new Date();
    const messageIds = input.sourceMessageIds ?? [];
    const [trade] = await tx.insert(schema.trades).values({
      ownerId,
      conversationId: input.conversationId,
      collectorId: input.collectorId,
      sourceMessageIds: messageIds,
      printsRequested: input.printsRequested,
      printsOffered: input.printsOffered,
      tradeStatus: status,
      statusSource: input.recordedBy === "owner" ? "owner_confirmed" : "ai_interpretation",
      proposedStatus,
      proposedStatusMessageIds: proposedStatus ? messageIds : [],
      firstSeenAt: at,
      lastUpdatedAt: at,
      decisionNotes: input.decisionNotes ?? null,
    }).returning();
    await tx.insert(schema.tradeRevisions).values({
      tradeId: trade!.tradeId,
      revision: 1,
      kind: input.kind,
      tradeStatus: status,
      printsRequested: input.printsRequested,
      printsOffered: input.printsOffered,
      sourceMessageIds: messageIds,
      actor: input.actor ?? "unknown",
      recordedBy: input.recordedBy,
      interpretation: input.interpretation ?? null,
      confidence: input.confidence ?? null,
      quote: input.quote ?? null,
      quoteVerified: input.quoteVerified ?? false,
      eventKey: input.eventKey ?? null,
    });
    await linkMessages(tx, ownerId, trade!.tradeId, messageIds, input.recordedBy === "ai" ? "ai_interpretation" : "message_fact");
    return { tradeId: trade!.tradeId, duplicate: false };
  });
}

async function linkMessages(tx: Tx, ownerId: string, tradeId: string, messageIds: string[], category: string) {
  if (messageIds.length === 0) {
    return;
  }
  await tx.insert(schema.evidenceRefs).values(messageIds.map(id => ({
    ownerId,
    subjectType: "trade",
    subjectId: tradeId,
    evidenceType: "message",
    refId: id,
    category,
  })));
}

export async function reviseTrade(ownerId: string, tradeId: string, input: RevisionInput) {
  return db.transaction(async (tx) => {
    if (input.eventKey) {
      const [seen] = await tx.select({ id: schema.tradeRevisions.id }).from(schema.tradeRevisions)
        .where(eq(schema.tradeRevisions.eventKey, input.eventKey)).limit(1);
      if (seen) {
        return { tradeId, duplicate: true };
      }
    }
    const [trade] = await tx.select().from(schema.trades)
      .where(and(eq(schema.trades.tradeId, tradeId), eq(schema.trades.ownerId, ownerId)))
      .for("update");
    if (!trade) {
      throw createError({ statusCode: 404, statusMessage: "Trade not found" });
    }

    const requested = input.printsRequested ?? trade.printsRequested;
    const offered = input.printsOffered ?? trade.printsOffered;
    let status = (input.status ?? trade.tradeStatus) as TradeStatus;
    let proposedStatus = trade.proposedStatus as TradeStatus | null;
    let proposedIds = trade.proposedStatusMessageIds;
    let statusSource = trade.statusSource;

    if (input.recordedBy === "ai") {
      if (input.status && !isAiSettable(input.status)) {
        proposedStatus = input.status;
        proposedIds = input.sourceMessageIds ?? [];
        status = trade.tradeStatus as TradeStatus;
      }
      // An AI change never overrides an owner-confirmed terminal status.
      if (trade.statusSource === "owner_confirmed" && !OPEN_STATUSES.includes(trade.tradeStatus as TradeStatus)) {
        status = trade.tradeStatus as TradeStatus;
      }
      else if (input.status && isAiSettable(input.status)) {
        statusSource = "ai_interpretation";
      }
    }
    else if (input.status) {
      statusSource = "owner_confirmed";
      if (proposedStatus === input.status || input.kind === "status_change") {
        proposedStatus = null;
        proposedIds = [];
      }
    }

    const revision = trade.currentRevision + 1;
    const messageIds = [...new Set([...trade.sourceMessageIds, ...(input.sourceMessageIds ?? [])])];
    const at = input.occurredAt ?? new Date();
    await tx.insert(schema.tradeRevisions).values({
      tradeId,
      revision,
      kind: input.kind,
      tradeStatus: status,
      printsRequested: requested,
      printsOffered: offered,
      sourceMessageIds: input.sourceMessageIds ?? [],
      actor: input.actor ?? (input.recordedBy === "owner" ? "owner" : "unknown"),
      recordedBy: input.recordedBy,
      interpretation: input.interpretation ?? null,
      confidence: input.confidence ?? null,
      quote: input.quote ?? null,
      quoteVerified: input.quoteVerified ?? false,
      eventKey: input.eventKey ?? null,
    });
    await tx.update(schema.trades).set({
      printsRequested: requested,
      printsOffered: offered,
      tradeStatus: status,
      statusSource,
      proposedStatus,
      proposedStatusMessageIds: proposedIds,
      sourceMessageIds: messageIds,
      currentRevision: revision,
      lastUpdatedAt: at > trade.lastUpdatedAt ? at : trade.lastUpdatedAt,
      decisionNotes: input.decisionNotes ?? trade.decisionNotes,
      // Terms changed, so an earlier recommendation no longer applies.
      ...(input.printsRequested || input.printsOffered
        ? { recommendation: null, rarityVerificationStatus: "not_checked", inventoryMatchStatus: "not_checked" }
        : {}),
    }).where(eq(schema.trades.tradeId, tradeId));
    await linkMessages(tx, ownerId, tradeId, input.sourceMessageIds ?? [], input.recordedBy === "ai" ? "ai_interpretation" : "message_fact");
    return { tradeId, duplicate: false, revision };
  });
}

/**
 * The owner sets a status. When confirming `completed`, `applyInventory`
 * decrements documented quantities of the prints the owner gave away.
 */
export async function ownerSetTradeStatus(ownerId: string, tradeId: string, input: {
  status: TradeStatus;
  notes?: string | null;
  applyInventory?: boolean;
}) {
  const result = await reviseTrade(ownerId, tradeId, {
    kind: "status_change",
    status: input.status,
    recordedBy: "owner",
    actor: "owner",
    interpretation: "Status set by the owner.",
    decisionNotes: input.notes ?? undefined,
  });

  const inventoryChanges: string[] = [];
  if (input.status === "completed" && input.applyInventory) {
    const [trade] = await db.select().from(schema.trades).where(eq(schema.trades.tradeId, tradeId));
    for (const line of trade!.printsRequested) {
      if (!line.printId) {
        inventoryChanges.push(`"${line.label}" is not matched to a catalog print; inventory not changed for it.`);
        continue;
      }
      const [item] = await db.select().from(schema.inventoryItems)
        .where(and(eq(schema.inventoryItems.ownerId, ownerId), eq(schema.inventoryItems.printId, line.printId)));
      if (!item) {
        inventoryChanges.push(`"${line.label}" is not in your documented inventory; nothing to update.`);
        continue;
      }
      const given = line.quantity ?? 1;
      if (item.quantity !== null) {
        const left = Math.max(0, item.quantity - given);
        await db.update(schema.inventoryItems).set({
          quantity: left,
          quantityBasis: "owner_confirmed_trade",
          availability: left === 0 ? "traded_away" : item.availability,
          notes: appendNote(item.notes, `${given} traded away (trade ${tradeId.slice(0, 8)}).`),
        }).where(eq(schema.inventoryItems.id, item.id));
        inventoryChanges.push(`${line.label}: ${item.quantity} → ${left}.`);
      }
      else {
        await db.update(schema.inventoryItems).set({
          notes: appendNote(item.notes, `${given} traded away (trade ${tradeId.slice(0, 8)}); remaining quantity unknown.`),
        }).where(eq(schema.inventoryItems.id, item.id));
        inventoryChanges.push(`${line.label}: quantity was unknown, so it was left unchanged and a note was added. Update it on the inventory page.`);
      }
    }
  }
  return { ...result, inventoryChanges };
}

function appendNote(existing: string | null, note: string) {
  return existing ? `${existing}\n${note}` : note;
}

export async function ownerCorrectTradeLines(ownerId: string, tradeId: string, input: {
  printsRequested?: Array<{ label: string; quantity: number | null; printId?: string | null }>;
  printsOffered?: Array<{ label: string; quantity: number | null; printId?: string | null }>;
  notes?: string | null;
}) {
  return reviseTrade(ownerId, tradeId, {
    kind: "owner_correction",
    printsRequested: input.printsRequested ? await resolveLines(input.printsRequested) : undefined,
    printsOffered: input.printsOffered ? await resolveLines(input.printsOffered) : undefined,
    recordedBy: "owner",
    actor: "owner",
    interpretation: "Prints corrected by the owner.",
    decisionNotes: input.notes ?? undefined,
  });
}

export async function getTrade(ownerId: string, tradeId: string) {
  const [trade] = await db.select().from(schema.trades)
    .where(and(eq(schema.trades.tradeId, tradeId), eq(schema.trades.ownerId, ownerId)));
  return trade ?? null;
}

export async function getTradeTimeline(ownerId: string, tradeId: string) {
  const trade = await getTrade(ownerId, tradeId);
  if (!trade) {
    return null;
  }
  const revisions = await db.select().from(schema.tradeRevisions)
    .where(eq(schema.tradeRevisions.tradeId, tradeId))
    .orderBy(schema.tradeRevisions.revision);
  const messageIds = [...new Set(revisions.flatMap(r => r.sourceMessageIds).concat(trade.proposedStatusMessageIds))];
  const messages = messageIds.length > 0
    ? await db.select({
        id: schema.messages.id,
        senderName: schema.messages.senderName,
        senderIsOwner: schema.messages.senderIsOwner,
        sentAt: schema.messages.sentAt,
        text: schema.messages.text,
        attachments: schema.messages.attachments,
        ingestionSource: schema.messages.ingestionSource,
      }).from(schema.messages)
        .where(and(eq(schema.messages.ownerId, ownerId), inArray(schema.messages.id, messageIds)))
        .orderBy(schema.messages.timestampMs)
    : [];
  const evaluations = await db.select().from(schema.tradeEvaluations)
    .where(eq(schema.tradeEvaluations.tradeId, tradeId))
    .orderBy(desc(schema.tradeEvaluations.createdAt))
    .limit(10);
  const [collector] = trade.collectorId
    ? await db.select().from(schema.collectors).where(eq(schema.collectors.id, trade.collectorId))
    : [];
  return { trade, revisions, messages, evaluations, collector: collector ?? null };
}

export async function listTrades(ownerId: string, filter: { statuses?: TradeStatus[]; collectorId?: string; limit?: number } = {}) {
  const conditions = [eq(schema.trades.ownerId, ownerId)];
  if (filter.statuses?.length) {
    conditions.push(inArray(schema.trades.tradeStatus, filter.statuses));
  }
  if (filter.collectorId) {
    conditions.push(eq(schema.trades.collectorId, filter.collectorId));
  }
  return db.select({
    trade: schema.trades,
    collectorName: schema.collectors.displayName,
  }).from(schema.trades)
    .leftJoin(schema.collectors, eq(schema.collectors.id, schema.trades.collectorId))
    .where(and(...conditions))
    .orderBy(desc(schema.trades.lastUpdatedAt))
    .limit(Math.min(filter.limit ?? 100, 500));
}

/** Open trades that ask the owner for any of these prints. */
export async function findCommitments(ownerId: string, printIds: string[], excludeTradeId?: string) {
  if (printIds.length === 0) {
    return [];
  }
  const rows = await db.select({
    tradeId: schema.trades.tradeId,
    status: schema.trades.tradeStatus,
    printsRequested: schema.trades.printsRequested,
  }).from(schema.trades)
    .where(and(
      eq(schema.trades.ownerId, ownerId),
      inArray(schema.trades.tradeStatus, [...OPEN_STATUSES]),
      excludeTradeId ? sql`${schema.trades.tradeId} <> ${excludeTradeId}` : sql`true`,
    ));
  return rows.flatMap(r => r.printsRequested
    .filter(l => l.printId && printIds.includes(l.printId))
    .map(l => ({ tradeId: r.tradeId, status: r.status, printId: l.printId!, quantity: l.quantity })));
}
