/**
 * Server side of the agent's tools. Each tool has a zod schema; the
 * internal route validates input against it and calls the handler with the
 * owner id taken from the eve session — never from model input — so every
 * query is scoped to that owner.
 */
import { and, eq, inArray } from "drizzle-orm";
import { db, schema } from "@nuxthub/db";
import { z } from "zod";
import { OPEN_STATUSES, TRADE_STATUSES } from "#shared/miniprint/types";
import type { AI_SETTABLE_STATUSES, TradeStatus } from "#shared/miniprint/types";
import { reverifyPrint } from "./catalog";
import { evaluateTrade } from "./evaluate";
import { getIngestionStatus } from "./ingest";
import { getInventory } from "./inventory";
import { createTrade, getTradeTimeline, listTrades, ownerSetTradeStatus, resolveLines, reviseTrade } from "./ledger";
import { getCollectorHistory, getConversationContext, getPrint, resolveCollector, searchMessages, searchPrintCatalog } from "./queries";

const uuid = z.string().uuid();
const line = z.object({
  label: z.string().min(1).max(200),
  quantity: z.number().int().min(1).max(100).nullable().default(null),
  printId: z.string().max(40).nullable().optional(),
});

function iso<T extends Record<string, unknown>>(row: T) {
  return Object.fromEntries(Object.entries(row).map(([k, v]) => [k, v instanceof Date ? v.toISOString() : v])) as T;
}

async function collectorIdFrom(ownerId: string, input: { collectorId?: string; collectorName?: string }) {
  if (!input.collectorId && !input.collectorName) {
    return undefined;
  }
  const matches = await resolveCollector(ownerId, { collectorId: input.collectorId, name: input.collectorName });
  if (matches.length === 0) {
    throw createError({ statusCode: 404, statusMessage: "No collector matches." });
  }
  if (matches.length > 1) {
    throw createError({ statusCode: 409, statusMessage: `Several collectors match: ${matches.map(m => `${m.displayName} (${m.id})`).join(", ")}. Pass collectorId.` });
  }
  return matches[0]!.id;
}

export const toolDefinitions = {
  search_messages: {
    schema: z.object({
      query: z.string().max(200).optional(),
      collectorId: uuid.optional(),
      collectorName: z.string().max(200).optional(),
      conversationId: uuid.optional(),
      since: z.string().datetime({ offset: true }).optional(),
      until: z.string().datetime({ offset: true }).optional(),
      limit: z.number().int().min(1).max(100).optional(),
    }),
    async run(ownerId: string, input: { query?: string; collectorId?: string; collectorName?: string; conversationId?: string; since?: string; until?: string; limit?: number }) {
      const collectorId = await collectorIdFrom(ownerId, input);
      return { messages: await searchMessages(ownerId, { ...input, collectorId }) };
    },
  },

  get_conversation_context: {
    schema: z.object({
      messageId: uuid.optional(),
      conversationId: uuid.optional(),
      before: z.number().int().min(0).max(60).optional(),
      after: z.number().int().min(0).max(60).optional(),
    }),
    run: (ownerId: string, input: { messageId?: string; conversationId?: string; before?: number; after?: number }) =>
      getConversationContext(ownerId, input),
  },

  get_collector_history: {
    schema: z.object({ collectorId: uuid.optional(), collectorName: z.string().max(200).optional() }),
    async run(ownerId: string, input: { collectorId?: string; collectorName?: string }) {
      const collectorId = await collectorIdFrom(ownerId, input);
      if (!collectorId) {
        throw createError({ statusCode: 400, statusMessage: "collectorId or collectorName is required" });
      }
      const history = await getCollectorHistory(ownerId, collectorId);
      return {
        collector: iso(history.collector),
        conversations: history.conversations,
        trades: history.trades.map(iso),
        revisions: history.revisions.map(iso),
        statedPreferences: history.preferences.map(iso),
      };
    },
  },

  get_inventory: {
    schema: z.object({
      availability: z.enum(["available", "traded_away", "removed"]).optional(),
      printIds: z.array(z.string().max(40)).max(50).optional(),
    }),
    async run(ownerId: string, input: { availability?: string; printIds?: string[] }) {
      const rows = await getInventory(ownerId, input);
      return {
        note: "Inventory covers only prints documented in your trade-post photos (plus manual additions); it is not a complete record of everything you own.",
        items: rows.map(r => ({
          printId: r.item.printId,
          canonicalName: r.print.canonicalName,
          artist: r.print.artist,
          rarity: r.print.verificationStatus === "verified" ? r.print.rarity : null,
          circulationStatus: r.print.circulationStatus,
          catalogUrl: r.print.catalogUrl,
          quantity: r.item.quantity,
          quantityBasis: r.item.quantityBasis,
          availability: r.item.availability,
        })),
      };
    },
  },

  search_print_catalog: {
    schema: z.object({ query: z.string().min(1).max(200), artist: z.string().max(100).optional() }),
    run: (_ownerId: string, input: { query: string; artist?: string }) => searchPrintCatalog(input),
  },

  verify_print_rarity: {
    schema: z.object({ printId: z.string().min(1).max(40) }),
    async run(_ownerId: string, input: { printId: string }) {
      const result = await reverifyPrint(input.printId);
      const print = await getPrint(input.printId);
      return { refreshed: result.ok, error: result.ok ? null : result.error, print };
    },
  },

  get_active_offers: {
    schema: z.object({
      collectorId: uuid.optional(),
      collectorName: z.string().max(200).optional(),
      statuses: z.array(z.enum(TRADE_STATUSES)).optional(),
    }),
    async run(ownerId: string, input: { collectorId?: string; collectorName?: string; statuses?: TradeStatus[] }) {
      const collectorId = await collectorIdFrom(ownerId, input);
      const rows = await listTrades(ownerId, { statuses: input.statuses ?? [...OPEN_STATUSES], collectorId });
      return {
        note: "Status reflects the latest messages imported. An offer is not necessarily still active just because it is recorded.",
        trades: rows.map(r => ({ ...iso(r.trade), collectorName: r.collectorName })),
      };
    },
  },

  get_trade_history: {
    schema: z.object({ tradeId: uuid }),
    async run(ownerId: string, input: { tradeId: string }) {
      const timeline = await getTradeTimeline(ownerId, input.tradeId);
      if (!timeline) {
        throw createError({ statusCode: 404, statusMessage: "Trade not found" });
      }
      return {
        trade: iso(timeline.trade),
        collector: timeline.collector ? iso(timeline.collector) : null,
        revisions: timeline.revisions.map(iso),
        messages: timeline.messages.map(iso),
        evaluations: timeline.evaluations.map(iso),
      };
    },
  },

  evaluate_trade: {
    schema: z.object({ tradeId: uuid }),
    run: (ownerId: string, input: { tradeId: string }) => evaluateTrade(ownerId, input.tradeId),
  },

  save_trade_event: {
    schema: z.object({
      conversationId: uuid,
      tradeId: uuid.optional(),
      type: z.enum(["new_offer", "counteroffer", "modification", "clarification_needed"]),
      printsRequestedFromOwner: z.array(line).max(50),
      printsOfferedToOwner: z.array(line).max(50),
      sourceMessageIds: z.array(uuid).min(1).max(50),
      interpretation: z.string().min(1).max(600),
    }),
    async run(ownerId: string, input: {
      conversationId: string;
      tradeId?: string;
      type: "new_offer" | "counteroffer" | "modification" | "clarification_needed";
      printsRequestedFromOwner: Array<z.infer<typeof line>>;
      printsOfferedToOwner: Array<z.infer<typeof line>>;
      sourceMessageIds: string[];
      interpretation: string;
    }) {
      const [conversation] = await db.select().from(schema.conversations)
        .where(and(eq(schema.conversations.id, input.conversationId), eq(schema.conversations.ownerId, ownerId)));
      if (!conversation) {
        throw createError({ statusCode: 404, statusMessage: "Conversation not found" });
      }
      // Evidence must be real messages from this conversation.
      const cited = await db.select().from(schema.messages)
        .where(and(eq(schema.messages.conversationId, conversation.id), inArray(schema.messages.id, input.sourceMessageIds)));
      if (cited.length !== new Set(input.sourceMessageIds).size) {
        throw createError({ statusCode: 400, statusMessage: "Every sourceMessageId must be a message in this conversation." });
      }
      const requested = await resolveLines(input.printsRequestedFromOwner);
      const offered = await resolveLines(input.printsOfferedToOwner);
      const status: (typeof AI_SETTABLE_STATUSES)[number] = input.type === "clarification_needed" ? "needs_clarification" : input.type === "counteroffer" ? "counteroffer" : "new_offer";
      const occurredAt = new Date(Math.max(...cited.map(m => m.timestampMs)));
      const collectorId = conversation.collectorId ?? cited.find(m => !m.senderIsOwner)?.collectorId ?? null;
      if (input.tradeId) {
        return reviseTrade(ownerId, input.tradeId, {
          kind: input.type === "counteroffer" ? "counteroffer" : "modification",
          status: input.type === "modification" ? undefined : status,
          printsRequested: requested,
          printsOffered: offered,
          sourceMessageIds: input.sourceMessageIds,
          recordedBy: "ai",
          interpretation: `[recorded by agent in chat] ${input.interpretation}`,
          confidence: "medium",
          occurredAt,
        });
      }
      return createTrade(ownerId, {
        kind: input.type === "counteroffer" ? "counteroffer" : "new_offer",
        conversationId: conversation.id,
        collectorId,
        printsRequested: requested,
        printsOffered: offered,
        status,
        sourceMessageIds: input.sourceMessageIds,
        recordedBy: "ai",
        interpretation: `[recorded by agent in chat] ${input.interpretation}`,
        confidence: "medium",
        occurredAt,
      });
    },
  },

  update_trade_status: {
    schema: z.object({
      tradeId: uuid,
      status: z.enum(TRADE_STATUSES),
      notes: z.string().max(1000).optional(),
      applyInventory: z.boolean().optional(),
    }),
    // Only reachable through the eve tool's always() approval gate.
    run: (ownerId: string, input: { tradeId: string; status: TradeStatus; notes?: string; applyInventory?: boolean }) =>
      ownerSetTradeStatus(ownerId, input.tradeId, {
        status: input.status,
        notes: input.notes ? `${input.notes} (approved in chat)` : "Approved in chat.",
        applyInventory: input.applyInventory,
      }),
  },

  get_ingestion_status: {
    schema: z.object({}),
    run: (ownerId: string) => getIngestionStatus(ownerId),
  },
} as const;

export type ToolName = keyof typeof toolDefinitions;
