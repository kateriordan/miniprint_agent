/**
 * Deletion of personal message data and everything derived from it.
 * Trades, revisions, evaluations, preferences and evidence links that were
 * built from the deleted messages are removed with them.
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import { db, schema } from "@nuxthub/db";

async function deleteEvidenceFor(tx: Parameters<Parameters<typeof db.transaction>[0]>[0], ownerId: string, tradeIds: string[], messageIds: string[]) {
  if (tradeIds.length > 0) {
    const evaluationIds = (await tx.select({ id: schema.tradeEvaluations.id }).from(schema.tradeEvaluations)
      .where(inArray(schema.tradeEvaluations.tradeId, tradeIds))).map(e => e.id);
    await tx.delete(schema.evidenceRefs).where(and(
      eq(schema.evidenceRefs.ownerId, ownerId),
      sql`(${schema.evidenceRefs.subjectType} = 'trade' and ${schema.evidenceRefs.subjectId} in ${tradeIds})
        ${evaluationIds.length > 0 ? sql`or (${schema.evidenceRefs.subjectType} = 'evaluation' and ${schema.evidenceRefs.subjectId} in ${evaluationIds})` : sql``}`,
    ));
  }
  if (messageIds.length > 0) {
    await tx.delete(schema.evidenceRefs).where(and(
      eq(schema.evidenceRefs.ownerId, ownerId),
      eq(schema.evidenceRefs.evidenceType, "message"),
      inArray(schema.evidenceRefs.refId, messageIds),
    ));
  }
}

/** Delete a conversation, its messages, and all trades and records derived from it. */
export async function deleteConversation(ownerId: string, conversationId: string) {
  return db.transaction(async (tx) => {
    const [conversation] = await tx.select({ id: schema.conversations.id }).from(schema.conversations)
      .where(and(eq(schema.conversations.id, conversationId), eq(schema.conversations.ownerId, ownerId)));
    if (!conversation) {
      throw createError({ statusCode: 404, statusMessage: "Conversation not found" });
    }
    const messageIds = (await tx.select({ id: schema.messages.id }).from(schema.messages)
      .where(eq(schema.messages.conversationId, conversationId))).map(m => m.id);
    const tradeIds = (await tx.select({ id: schema.trades.tradeId }).from(schema.trades)
      .where(eq(schema.trades.conversationId, conversationId))).map(t => t.id);
    await deleteEvidenceFor(tx, ownerId, tradeIds, messageIds);
    // Cascades: messages → preferences; trades → revisions, evaluations.
    await tx.delete(schema.conversations).where(eq(schema.conversations.id, conversationId));
    await tx.delete(schema.analysisJobs).where(eq(schema.analysisJobs.idempotencyKey, `analyze:${conversationId}`));
    return { messagesDeleted: messageIds.length, tradesDeleted: tradeIds.length };
  });
}

/** Delete one message. Trades that cite it are deleted too, since their evidence is gone. */
export async function deleteMessage(ownerId: string, messageId: string) {
  return db.transaction(async (tx) => {
    const [message] = await tx.select({ id: schema.messages.id }).from(schema.messages)
      .where(and(eq(schema.messages.id, messageId), eq(schema.messages.ownerId, ownerId)));
    if (!message) {
      throw createError({ statusCode: 404, statusMessage: "Message not found" });
    }
    const tradeIds = (await tx.select({ id: schema.trades.tradeId }).from(schema.trades)
      .where(and(eq(schema.trades.ownerId, ownerId), sql`${schema.trades.sourceMessageIds} @> ${JSON.stringify([messageId])}::jsonb`)))
      .map(t => t.id);
    await deleteEvidenceFor(tx, ownerId, tradeIds, [messageId]);
    if (tradeIds.length > 0) {
      await tx.delete(schema.trades).where(inArray(schema.trades.tradeId, tradeIds));
    }
    await tx.delete(schema.messages).where(eq(schema.messages.id, messageId));
    return { messagesDeleted: 1, tradesDeleted: tradeIds.length };
  });
}

/** Delete a collector and every conversation and message involving them. */
export async function deleteCollector(ownerId: string, collectorId: string) {
  const conversations = await db.select({ id: schema.conversations.id }).from(schema.conversations)
    .where(and(eq(schema.conversations.ownerId, ownerId), eq(schema.conversations.collectorId, collectorId)));
  let messagesDeleted = 0;
  let tradesDeleted = 0;
  for (const c of conversations) {
    const r = await deleteConversation(ownerId, c.id);
    messagesDeleted += r.messagesDeleted;
    tradesDeleted += r.tradesDeleted;
  }
  // Their messages in group conversations.
  const groupMessages = await db.select({ id: schema.messages.id }).from(schema.messages)
    .where(and(eq(schema.messages.ownerId, ownerId), eq(schema.messages.collectorId, collectorId)));
  for (const m of groupMessages) {
    const r = await deleteMessage(ownerId, m.id);
    messagesDeleted += r.messagesDeleted;
    tradesDeleted += r.tradesDeleted;
  }
  await db.delete(schema.collectors).where(and(eq(schema.collectors.id, collectorId), eq(schema.collectors.ownerId, ownerId)));
  return { messagesDeleted, tradesDeleted };
}

/** Delete all Messenger-derived data for the owner. Inventory and catalog are kept. */
export async function deleteAllMessageData(ownerId: string) {
  return db.transaction(async (tx) => {
    await tx.delete(schema.evidenceRefs).where(and(
      eq(schema.evidenceRefs.ownerId, ownerId),
      inArray(schema.evidenceRefs.subjectType, ["trade", "evaluation", "trade_revision", "collector_preference"]),
    ));
    await tx.delete(schema.evidenceRefs).where(and(eq(schema.evidenceRefs.ownerId, ownerId), eq(schema.evidenceRefs.evidenceType, "message")));
    await tx.delete(schema.conversations).where(eq(schema.conversations.ownerId, ownerId));
    await tx.delete(schema.collectors).where(eq(schema.collectors.ownerId, ownerId));
    await tx.delete(schema.importBatches).where(eq(schema.importBatches.ownerId, ownerId));
    await tx.delete(schema.ingestionGaps).where(eq(schema.ingestionGaps.ownerId, ownerId));
    await tx.delete(schema.analysisJobs).where(and(eq(schema.analysisJobs.ownerId, ownerId), eq(schema.analysisJobs.kind, "conversation_analyze")));
    return { ok: true };
  });
}
