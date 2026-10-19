/** Read models for the dashboard. */
import { inArray } from "drizzle-orm";
import { db, schema } from "@nuxthub/db";
import { OPEN_STATUSES } from "#shared/miniprint/types";
import type { TradeStatus } from "#shared/miniprint/types";
import { toCatalogFact } from "./catalog";
import { listTrades } from "./ledger";

const INCOMING: TradeStatus[] = ["new_offer", "needs_clarification", "counteroffer", "under_review", "unknown"];
const RECOMMENDATION_RANK = { accept: 4, negotiate: 3, request_clarification: 2, decline: 0 } as const;

export async function tradeList(ownerId: string, view: "incoming" | "opportunities" | "all", collectorId?: string) {
  const statuses = view === "incoming" ? INCOMING : view === "opportunities" ? [...OPEN_STATUSES] : undefined;
  let rows = await listTrades(ownerId, { statuses, collectorId, limit: 300 });
  if (view === "incoming") {
    // Include anything with an unconfirmed status suggestion too.
    const proposed = (await listTrades(ownerId, { collectorId, limit: 300 })).filter(r => r.trade.proposedStatus && !rows.some(x => x.trade.tradeId === r.trade.tradeId));
    rows = [...rows, ...proposed];
  }

  const printIds = [...new Set(rows.flatMap(r => [...r.trade.printsRequested, ...r.trade.printsOffered].map(l => l.printId).filter((x): x is string => !!x)))];
  const catalog = printIds.length > 0
    ? await db.select().from(schema.catalogPrints).where(inArray(schema.catalogPrints.printId, printIds))
    : [];
  const facts = Object.fromEntries(catalog.map(c => [c.printId, toCatalogFact(c)]));

  let trades = rows.map(r => ({ ...r.trade, collectorName: r.collectorName }));
  if (view === "opportunities") {
    const score = (t: typeof trades[number]) => {
      const rec = t.recommendation ? RECOMMENDATION_RANK[t.recommendation.action] : 1;
      return rec * 100
        + (t.inventoryMatchStatus === "all_available" ? 20 : 0)
        + (t.rarityVerificationStatus === "all_verified" ? 10 : 0)
        - Math.min(9, Math.floor((Date.now() - t.lastUpdatedAt.getTime()) / (14 * 86_400_000)));
    };
    trades = trades
      .filter(t => t.recommendation?.action !== "decline")
      .sort((a, b) => score(b) - score(a));
  }
  return { trades, catalog: facts };
}
