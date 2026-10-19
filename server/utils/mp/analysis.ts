/**
 * Incremental conversation analysis.
 *
 * Each run takes the next window of unprocessed messages in one
 * conversation, plus a little preceding context and the conversation's open
 * trades, and asks the model to extract trade events. Only that window goes
 * to the model — never the whole archive.
 *
 * The output is checked in code before it touches the ledger:
 * - cited message refs must belong to the window or its context;
 * - each event's quote must appear in a cited message, or the event is
 *   downgraded to low confidence and marked unverified;
 * - print names are matched against the catalog by `resolveLines`;
 * - status changes go through the ledger's AI rules (terminal statuses
 *   become proposals).
 */
import { createHash } from "node:crypto";
import { and, asc, desc, eq, inArray, lt, sql } from "drizzle-orm";
import { db, schema } from "@nuxthub/db";
import { z } from "zod";
import { normalizeName } from "#shared/miniprint/match";
import { OPEN_STATUSES } from "#shared/miniprint/types";
import type { TradeStatus } from "#shared/miniprint/types";
import { createTrade, resolveLines, reviseTrade } from "./ledger";
import { analysisModelId, dataBlock, generateStructured } from "./llm";
import { JobContinuation } from "./jobs";
import type { Job, JobContext } from "./jobs";

const WINDOW = 60;
const CONTEXT = 25;

const lineSchema = z.object({
  label: z.string().min(1).max(200).describe("The print as named in the messages"),
  quantity: z.number().int().min(1).max(100).nullable().describe("Only if a number is stated; otherwise null"),
});

const eventSchema = z.object({
  type: z.enum([
    "new_offer",
    "counteroffer",
    "modification",
    "accepted",
    "completed",
    "declined",
    "cancelled",
    "expired",
    "clarification_needed",
    "preference",
  ]),
  tradeRef: z.string().nullable().describe("Ref of an existing trade (t1, t2, …) this event changes, or null"),
  newTradeKey: z.string().nullable().describe("For events about a trade first proposed in this window: a key like n1 shared by all events about it"),
  actor: z.enum(["collector", "owner", "unknown"]).describe("Who sent the message that caused this event"),
  printsRequestedFromOwner: z.array(lineSchema).describe("Complete current list of prints the collector would receive from the owner, after this event"),
  printsOfferedToOwner: z.array(lineSchema).describe("Complete current list of prints the owner would receive, after this event"),
  messageRefs: z.array(z.string()).min(1).describe("Refs (m1, m2, …) of the messages this event is based on"),
  quote: z.string().max(400).describe("An exact excerpt copied from one of the cited messages"),
  interpretation: z.string().max(600).describe("One or two sentences: what happened and why you read it that way, including any ambiguity"),
  confidence: z.enum(["high", "medium", "low"]),
  preferenceKind: z.enum(["wishlist", "wants", "not_interested", "collects", "other"]).nullable()
    .describe("Only for type=preference: what the collector explicitly said"),
});

const outputSchema = z.object({
  events: z.array(eventSchema).max(40),
});

const SYSTEM = `You extract trade events from a Messenger conversation between the owner (a miniature art-print collector) and other collectors.

Event types:
- new_offer: someone proposes a specific exchange of prints that is not already an open trade.
- counteroffer: a reply proposes different terms for an existing or just-proposed trade.
- modification: someone changes an earlier offer (adds/removes prints, changes quantities) without it being a counteroffer.
- accepted / declined / cancelled / completed / expired: the messages explicitly say so (e.g. "deal", "no thanks", "never mind", "received it, thanks!"). Only when it is clear which trade it refers to.
- clarification_needed: an offer is too vague to record terms (e.g. "I'll trade you something for that one").
- preference: a collector explicitly states what they collect, want, or don't want. Never infer preferences.

Rules:
- Use earlier context to interpret short replies like "yes", "that works", "I'll do that one". If you cannot tell what they refer to, use clarification_needed or lower confidence; do not guess.
- prints lists are always the complete terms after the event, from the owner's perspective: printsRequestedFromOwner = what the owner would give; printsOfferedToOwner = what the owner would get.
- Use print names exactly as written in the messages. Do not correct, expand, or translate them; do not add rarity.
- A photo attachment you cannot see means the prints in it are unknown — say so in interpretation.
- An old offer is not necessarily still active. Do not mark anything expired unless the messages say so.
- Return an empty events list when nothing trade-related happens.`;

function sha(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function formatMessage(ref: string, m: typeof schema.messages.$inferSelect) {
  const who = m.senderIsOwner ? `${m.senderName} (owner)` : `${m.senderName} (collector)`;
  const attachments = m.attachments.length > 0
    ? ` [attachments: ${m.attachments.map(a => a.type).join(", ")} — contents not available]`
    : "";
  const unsent = m.isUnsent ? " [message was unsent]" : "";
  return `[${ref}] ${m.sentAt.toISOString()} | ${who}: ${m.text ?? ""}${attachments}${unsent}`;
}

function quoteFound(quote: string, texts: string[]) {
  const q = normalizeName(quote);
  if (q.length < 2) {
    return false;
  }
  return texts.some(t => normalizeName(t).includes(q));
}

export async function analyzeConversationJob(job: Job, _ctx: JobContext) {
  const ownerId = job.ownerId!;
  const conversationId = String(job.payload.conversationId);
  const [conversation] = await db.select().from(schema.conversations)
    .where(and(eq(schema.conversations.id, conversationId), eq(schema.conversations.ownerId, ownerId)));
  if (!conversation) {
    return { skipped: "conversation deleted" };
  }

  const windowMessages = await db.select().from(schema.messages)
    .where(and(eq(schema.messages.conversationId, conversationId), eq(schema.messages.processingStatus, "pending")))
    .orderBy(asc(schema.messages.timestampMs))
    .limit(WINDOW);
  if (windowMessages.length === 0) {
    return { analyzed: 0 };
  }

  // Window with nothing to read (all attachments/unsent) — mark and move on.
  if (windowMessages.every(m => !m.text?.trim())) {
    await markProcessed(windowMessages.map(m => m.id), "skipped");
    throw new JobContinuation(job.payload);
  }

  const first = windowMessages[0]!;
  const context = (await db.select().from(schema.messages)
    .where(and(
      eq(schema.messages.conversationId, conversationId),
      lt(schema.messages.timestampMs, first.timestampMs),
    ))
    .orderBy(desc(schema.messages.timestampMs))
    .limit(CONTEXT)).reverse();

  const openTrades = await db.select().from(schema.trades)
    .where(and(eq(schema.trades.conversationId, conversationId), inArray(schema.trades.tradeStatus, [...OPEN_STATUSES])))
    .orderBy(desc(schema.trades.lastUpdatedAt))
    .limit(10);

  const refToMessage = new Map<string, typeof schema.messages.$inferSelect>();
  const windowRefs = new Set<string>();
  const lines: string[] = [];
  let n = 0;
  for (const m of context) {
    const ref = `m${++n}`;
    refToMessage.set(ref, m);
    lines.push(formatMessage(ref, m));
  }
  const contextText = lines.splice(0).join("\n");
  for (const m of windowMessages) {
    const ref = `m${++n}`;
    refToMessage.set(ref, m);
    windowRefs.add(ref);
    lines.push(formatMessage(ref, m));
  }
  const windowText = lines.join("\n");

  const refToTrade = new Map<string, typeof schema.trades.$inferSelect>();
  const tradeText = openTrades.map((t, i) => {
    const ref = `t${i + 1}`;
    refToTrade.set(ref, t);
    const side = (l: typeof t.printsRequested) => l.map(x => `${x.quantity ? `${x.quantity}× ` : ""}${x.label}`).join(", ") || "(none recorded)";
    return `${ref}: status=${t.tradeStatus}; owner gives: ${side(t.printsRequested)}; owner gets: ${side(t.printsOffered)}; last activity ${t.lastUpdatedAt.toISOString()}`;
  }).join("\n") || "(no open trades)";

  const result = await generateStructured({
    model: analysisModelId(),
    system: SYSTEM,
    schema: outputSchema,
    messages: [{
      role: "user",
      content: [
        `Conversation: ${conversation.isGroup ? "group" : "one-to-one"}; participants: ${conversation.participants.join(", ")}.`,
        "",
        "Open trades already recorded in this conversation:",
        dataBlock("ledger", tradeText),
        "",
        "Earlier messages (context only; already analyzed):",
        dataBlock("messenger-context", contextText || "(none)"),
        "",
        "New messages to analyze — report events these messages cause:",
        dataBlock("messenger-new", windowText),
      ].join("\n"),
    }],
  });

  const newTradeIds = new Map<string, string>();
  const applied: string[] = [];
  const dropped: string[] = [];

  for (const event of result.events) {
    const cited = event.messageRefs.filter(r => refToMessage.has(r));
    if (cited.length === 0 || !cited.some(r => windowRefs.has(r))) {
      dropped.push(`${event.type}: no valid message refs in the new window`);
      continue;
    }
    const citedMessages = cited.map(r => refToMessage.get(r)!);
    const messageIds = citedMessages.map(m => m.id);
    const quoteVerified = quoteFound(event.quote, citedMessages.map(m => m.text ?? ""));
    const confidence = quoteVerified ? event.confidence : "low";
    const interpretation = quoteVerified
      ? event.interpretation
      : `${event.interpretation} (Quoted text could not be found in the cited messages; treat as unverified.)`;
    const occurredAt = new Date(Math.max(...citedMessages.map(m => m.timestampMs)));
    const eventKey = sha([conversationId, event.type, [...messageIds].sort().join(","), event.tradeRef ?? event.newTradeKey ?? ""].join("|"));
    const collectorMessage = citedMessages.find(m => !m.senderIsOwner);
    const collectorId = conversation.collectorId ?? collectorMessage?.collectorId ?? null;

    if (event.type === "preference") {
      if (!collectorMessage || !quoteVerified || event.actor !== "collector") {
        dropped.push("preference: not an explicit, verifiable collector statement");
        continue;
      }
      const [line] = event.printsRequestedFromOwner.length > 0
        ? await resolveLines([event.printsRequestedFromOwner[0]!])
        : [null];
      await db.insert(schema.collectorPreferences).values({
        ownerId,
        collectorId: collectorMessage.collectorId ?? collectorId!,
        kind: event.preferenceKind ?? "other",
        printId: line?.printId ?? null,
        printLabel: line?.label ?? null,
        quote: event.quote,
        sourceMessageId: collectorMessage.id,
      }).onConflictDoNothing();
      applied.push("preference");
      continue;
    }

    const existing = event.tradeRef ? refToTrade.get(event.tradeRef) : undefined;
    const pendingNewId = event.newTradeKey ? newTradeIds.get(event.newTradeKey) : undefined;
    const targetId = existing?.tradeId ?? pendingNewId;

    const requested = await resolveLines(event.printsRequestedFromOwner);
    const offered = await resolveLines(event.printsOfferedToOwner);
    const hasTerms = requested.length + offered.length > 0;

    const statusFor: Partial<Record<typeof event.type, TradeStatus>> = {
      new_offer: "new_offer",
      counteroffer: "counteroffer",
      accepted: "accepted",
      completed: "completed",
      declined: "declined",
      cancelled: "cancelled",
      expired: "expired",
      clarification_needed: "needs_clarification",
    };
    let status = statusFor[event.type];
    if (confidence === "low" && (event.type === "new_offer" || event.type === "counteroffer")) {
      status = "needs_clarification";
    }

    if (!targetId) {
      if (!["new_offer", "counteroffer", "modification", "clarification_needed"].includes(event.type)) {
        dropped.push(`${event.type}: could not tell which trade it refers to`);
        continue;
      }
      const created = await createTrade(ownerId, {
        kind: event.type === "counteroffer" ? "counteroffer" : "new_offer",
        conversationId,
        collectorId,
        printsRequested: requested,
        printsOffered: offered,
        status: hasTerms ? status ?? "new_offer" : "needs_clarification",
        sourceMessageIds: messageIds,
        actor: event.actor,
        recordedBy: "ai",
        interpretation,
        confidence,
        quote: event.quote,
        quoteVerified,
        eventKey,
        occurredAt,
      });
      if (event.newTradeKey) {
        newTradeIds.set(event.newTradeKey, created.tradeId);
      }
      applied.push(event.type);
      continue;
    }

    const changesTerms = ["new_offer", "counteroffer", "modification"].includes(event.type) && hasTerms;
    await reviseTrade(ownerId, targetId, {
      kind: event.type === "counteroffer" ? "counteroffer" : changesTerms ? "modification" : "status_change",
      status,
      printsRequested: changesTerms ? requested : undefined,
      printsOffered: changesTerms ? offered : undefined,
      sourceMessageIds: messageIds,
      actor: event.actor,
      recordedBy: "ai",
      interpretation,
      confidence,
      quote: event.quote,
      quoteVerified,
      eventKey,
      occurredAt,
    });
    applied.push(event.type);
  }

  await markProcessed(windowMessages.map(m => m.id), "processed");
  await db.update(schema.conversations)
    .set({ analyzedThrough: windowMessages.at(-1)!.sentAt })
    .where(eq(schema.conversations.id, conversationId));

  const [more] = await db.select({ id: schema.messages.id }).from(schema.messages)
    .where(and(eq(schema.messages.conversationId, conversationId), eq(schema.messages.processingStatus, "pending")))
    .limit(1);
  if (more) {
    // Requeue rather than loop, so one long conversation cannot starve others.
    throw new JobContinuation(job.payload);
  }
  return { analyzed: windowMessages.length, applied, dropped, model: analysisModelId() };
}

async function markProcessed(ids: string[], status: "processed" | "skipped") {
  if (ids.length === 0) {
    return;
  }
  await db.update(schema.messages)
    .set({ processingStatus: status, processedAt: sql`now()` })
    .where(inArray(schema.messages.id, ids));
}
