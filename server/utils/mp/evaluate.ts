/**
 * Trade evaluation. Deterministic: it gathers verified facts, labels each by
 * evidence category, lists what is unknown, and applies explicit rules to
 * suggest a next step. It never changes a trade's status or inventory —
 * the result is stored as a recommendation only.
 */
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db, schema } from "@nuxthub/db";
import { DEFAULT_TIER_CONFIG, tierFor } from "#shared/miniprint/tiers";
import type { TierConfig } from "#shared/miniprint/tiers";
import type {
  EvaluatedPrint,
  EvaluationFacts,
  EvidenceItem,
  RecommendationAction,
  TradeLine,
  TradeRecommendation,
} from "#shared/miniprint/types";
import { ensureFresh, toCatalogFact } from "./catalog";
import { findCommitments, getTrade } from "./ledger";
import { getOwnerSettings } from "./settings";

function sideSummary(prints: EvaluatedPrint[], side: EvaluatedPrint["side"]) {
  const list = prints.filter(p => p.side === side);
  const rarities: Record<string, number> = {};
  let ooc = 0;
  let count = 0;
  for (const p of list) {
    // An unstated quantity is tallied as one and flagged in the uncertainties.
    const q = p.quantity ?? 1;
    count += q;
    const rarity = p.catalog?.rarity ?? "unverified";
    rarities[rarity] = (rarities[rarity] ?? 0) + q;
    if (p.catalog?.circulationStatus === "out_of_circulation") {
      ooc += q;
    }
  }
  return { count, rarities, outOfCirculation: ooc };
}

function tierTally(prints: EvaluatedPrint[], side: EvaluatedPrint["side"], config: TierConfig) {
  const tally: Record<number, number> = {};
  let unplaced = 0;
  for (const p of prints.filter(x => x.side === side)) {
    const tier = p.catalog ? tierFor(p.catalog.rarity, p.catalog.circulationStatus, config) : null;
    const q = p.quantity ?? 1;
    if (tier === null) {
      unplaced += q;
    }
    else {
      tally[tier] = (tally[tier] ?? 0) + q;
    }
  }
  return { tally, unplaced };
}

/** Compare tier tallies from the hardest tier down. Positive: owner receives more of the harder tier. */
function compareTallies(give: Record<number, number>, get: Record<number, number>) {
  const tiers = [...new Set([...Object.keys(give), ...Object.keys(get)].map(Number))].sort((a, b) => b - a);
  for (const t of tiers) {
    const diff = (get[t] ?? 0) - (give[t] ?? 0);
    if (diff !== 0) {
      return { tier: t, diff };
    }
  }
  return { tier: null, diff: 0 };
}

export async function evaluateTrade(ownerId: string, tradeId: string) {
  const trade = await getTrade(ownerId, tradeId);
  if (!trade) {
    throw createError({ statusCode: 404, statusMessage: "Trade not found" });
  }
  const settings = await getOwnerSettings(ownerId);
  const tiers = settings.tierConfig ?? DEFAULT_TIER_CONFIG;

  const lines: Array<{ side: EvaluatedPrint["side"]; line: TradeLine }> = [
    ...trade.printsRequested.map(line => ({ side: "requested_from_owner" as const, line })),
    ...trade.printsOffered.map(line => ({ side: "offered_to_owner" as const, line })),
  ];
  const printIds = [...new Set(lines.map(l => l.line.printId).filter((id): id is string => !!id))];

  // Step 3: re-verify every involved print against miniprint.io if older than a day.
  const refreshFailures = await ensureFresh(printIds);
  const catalogRows = printIds.length > 0
    ? await db.select().from(schema.catalogPrints).where(inArray(schema.catalogPrints.printId, printIds))
    : [];
  const catalogById = new Map(catalogRows.map(r => [r.printId, toCatalogFact(r)]));

  // Step 4–5: inventory and conflicting commitments for what the owner would give.
  const giveIds = trade.printsRequested.map(l => l.printId).filter((id): id is string => !!id);
  const inventory = giveIds.length > 0
    ? await db.select().from(schema.inventoryItems)
        .where(and(eq(schema.inventoryItems.ownerId, ownerId), inArray(schema.inventoryItems.printId, giveIds)))
    : [];
  const inventoryById = new Map(inventory.map(i => [i.printId, i]));
  const commitments = await findCommitments(ownerId, giveIds, tradeId);

  const prints: EvaluatedPrint[] = lines.map(({ side, line }) => {
    const fact = line.printId ? catalogById.get(line.printId) ?? null : null;
    const evaluated: EvaluatedPrint = {
      side,
      label: line.label,
      quantity: line.quantity,
      printId: line.printId,
      matchStatus: line.matchStatus,
      candidatePrintIds: line.candidatePrintIds,
      catalog: fact,
    };
    if (side === "requested_from_owner") {
      const item = line.printId ? inventoryById.get(line.printId) : undefined;
      evaluated.inventory = {
        documented: !!item,
        quantity: item?.quantity ?? null,
        availability: item?.availability ?? null,
        committedElsewhere: commitments.filter(c => c.printId === line.printId).map(c => ({ tradeId: c.tradeId, status: c.status })),
      };
    }
    return evaluated;
  });

  const evidence: EvidenceItem[] = [];
  const uncertainties: string[] = [];
  const missing: string[] = [];

  for (const p of prints) {
    const who = p.side === "requested_from_owner" ? "You would give" : "You would receive";
    if (!p.printId || !p.catalog) {
      uncertainties.push(`${who} "${p.label}", which is not matched to a MiniPrint.io catalog print (${p.matchStatus}${p.candidatePrintIds.length ? `; possible: ${p.candidatePrintIds.join(", ")}` : ""}).`);
      missing.push(`Which catalog print "${p.label}" is.`);
      evidence.push({ category: "unknown", statement: `"${p.label}" — catalog identity unknown.`, refs: [] });
      continue;
    }
    const c = p.catalog;
    if (c.rarity) {
      evidence.push({
        category: "verified_catalog_fact",
        statement: `${c.canonicalName} (${c.artist}): rarity "${c.rarity}", ${c.circulationStatus.replace(/_/g, " ")}; verified ${c.verifiedAt}.`,
        refs: [{ type: "catalog_record", id: c.printId, url: c.catalogUrl }],
      });
    }
    else {
      uncertainties.push(`${c.canonicalName}: MiniPrint.io rarity is not verified (${c.verificationStatus}).`);
      evidence.push({ category: "unknown", statement: `${c.canonicalName}: rarity not verified.`, refs: [{ type: "catalog_record", id: c.printId, url: c.catalogUrl }] });
    }
    if (c.verificationStatus === "stale") {
      uncertainties.push(`${c.canonicalName}: catalog data could not be refreshed and may be out of date.`);
    }
    if (p.quantity === null) {
      uncertainties.push(`Quantity of "${p.label}" is not stated in the messages; counted as one.`);
    }
    if (p.inventory) {
      if (!p.inventory.documented) {
        uncertainties.push(`${c.canonicalName} is not in your photo-documented inventory. You may still own it — the inventory only covers your trade-post photos.`);
      }
      else if (p.inventory.availability !== "available") {
        uncertainties.push(`${c.canonicalName} is marked ${p.inventory.availability?.replace(/_/g, " ")} in your inventory.`);
      }
      else {
        const qty = p.inventory.quantity;
        const basis = inventoryById.get(p.printId)?.quantityBasis;
        const qtyText = qty === null
          ? " (quantity unknown)"
          : basis === "photo_min_visible" ? ` (at least ${qty} visible in one of your photos)` : ` (quantity ${qty}, entered by you)`;
        evidence.push({
          category: "message_fact",
          statement: `${c.canonicalName} is in your documented inventory${qtyText}.`,
          refs: [{ type: "inventory_item", id: c.printId }],
        });
      }
      if (p.inventory.committedElsewhere.length > 0) {
        const needed = (p.quantity ?? 1) + commitments.filter(x => x.printId === p.printId).reduce((s, x) => s + (x.quantity ?? 1), 0);
        const have = p.inventory.quantity;
        uncertainties.push(`${c.canonicalName} is also requested in ${p.inventory.committedElsewhere.length} other open trade(s)${have !== null ? `; ${needed} requested in total vs. ${have} documented` : ""}.`);
        evidence.push({
          category: "message_fact",
          statement: `${c.canonicalName} appears in other open trades.`,
          refs: p.inventory.committedElsewhere.map(t => ({ type: "trade" as const, id: t.tradeId })),
        });
      }
    }
  }
  for (const f of refreshFailures) {
    uncertainties.push(`Could not re-verify ${f.printId} on miniprint.io just now: ${f.error}`);
  }

  // Step 6–7: collector history and stated preferences.
  const priorTrades = trade.collectorId
    ? await db.select({ tradeId: schema.trades.tradeId, status: schema.trades.tradeStatus, lastUpdatedAt: schema.trades.lastUpdatedAt })
        .from(schema.trades)
        .where(and(eq(schema.trades.ownerId, ownerId), eq(schema.trades.collectorId, trade.collectorId), sql`${schema.trades.tradeId} <> ${tradeId}`))
        .orderBy(desc(schema.trades.lastUpdatedAt))
        .limit(20)
    : [];
  const preferences = trade.collectorId
    ? await db.select().from(schema.collectorPreferences)
        .where(and(eq(schema.collectorPreferences.ownerId, ownerId), eq(schema.collectorPreferences.collectorId, trade.collectorId)))
        .orderBy(desc(schema.collectorPreferences.createdAt))
        .limit(20)
    : [];
  for (const pref of preferences) {
    evidence.push({
      category: "stated_preference",
      statement: `Collector said (${pref.kind.replace(/_/g, " ")}): “${pref.quote}”`,
      refs: [{ type: "message", id: pref.sourceMessageId }],
    });
  }

  const revisions = await db.select().from(schema.tradeRevisions)
    .where(eq(schema.tradeRevisions.tradeId, tradeId))
    .orderBy(desc(schema.tradeRevisions.revision))
    .limit(5);
  for (const r of revisions) {
    if (r.interpretation) {
      evidence.push({
        category: r.recordedBy === "owner" ? "message_fact" : "ai_interpretation",
        statement: `Revision ${r.revision} (${r.kind.replace(/_/g, " ")}): ${r.interpretation}${r.recordedBy === "ai" && r.quote && !r.quoteVerified ? " [quote not found in the cited messages]" : ""}`,
        refs: r.sourceMessageIds.map(id => ({ type: "message" as const, id })),
      });
    }
  }
  if (trade.proposedStatus) {
    uncertainties.push(`Messages suggest this trade may be ${trade.proposedStatus}; you have not confirmed that.`);
  }
  const daysIdle = (Date.now() - trade.lastUpdatedAt.getTime()) / 86_400_000;
  if (daysIdle > 30) {
    uncertainties.push(`No activity for ${Math.floor(daysIdle)} days — the offer may no longer stand.`);
  }

  // Step 8–9: assessment and recommendation.
  const give = tierTally(prints, "requested_from_owner", tiers);
  const get = tierTally(prints, "offered_to_owner", tiers);
  const unresolved = prints.some(p => !p.catalog || !p.catalog.rarity);
  const notAvailable = prints.some(p => p.inventory && (!p.inventory.documented || p.inventory.availability !== "available"));
  const conflicts = prints.some(p => (p.inventory?.committedElsewhere.length ?? 0) > 0);
  const emptySide = trade.printsRequested.length === 0 || trade.printsOffered.length === 0;

  let action: RecommendationAction;
  let reason: string;
  if (emptySide) {
    action = "request_clarification";
    reason = "The terms are incomplete: one side of the trade has no prints recorded.";
    missing.push("The full set of prints on both sides.");
  }
  else if (unresolved || give.unplaced > 0 || get.unplaced > 0) {
    action = "request_clarification";
    reason = "Some prints are not matched to verified MiniPrint.io records, so the sides cannot be compared.";
  }
  else if (notAvailable) {
    action = "request_clarification";
    reason = "At least one print you would give is not documented as available in your inventory — confirm you have it before going further.";
    missing.push("Whether you own the requested print(s) not shown in your photos.");
  }
  else {
    const cmp = compareTallies(give.tally, get.tally);
    const label = (t: number | null) => (t === null ? "" : tiers.labels[t] ?? `tier ${t}`);
    if (cmp.diff > 0) {
      action = conflicts ? "negotiate" : "accept";
      reason = `By your ordering, you would receive more ${label(cmp.tier)} prints than you give.${conflicts ? " But a print you'd give is also promised in another open trade." : ""}`;
    }
    else if (cmp.diff === 0) {
      action = conflicts ? "negotiate" : "accept";
      reason = `By your ordering, both sides are even tier for tier.${conflicts ? " But a print you'd give is also promised in another open trade." : ""}`;
    }
    else {
      const giveTop = Math.max(...Object.keys(give.tally).map(Number));
      const getTop = Math.max(...Object.keys(get.tally).map(Number), 0);
      action = giveTop > getTop && cmp.tier === giveTop ? "decline" : "negotiate";
      reason = action === "decline"
        ? `You would give a ${label(giveTop)} print and receive nothing in that tier.`
        : `By your ordering, you would give more ${label(cmp.tier)} prints than you receive.`;
    }
  }

  const ordering = Object.entries(tiers.labels).sort(([a], [b]) => Number(a) - Number(b)).map(([, l]) => l).join(" < ");
  uncertainties.push(`Rarity tiers are not prices. The comparison uses your own ordering (${ordering}) and cannot tell how much you or the collector want these specific prints.`);

  const facts: EvaluationFacts = {
    prints,
    evidence,
    uncertainties,
    missingInformation: [...new Set(missing)],
    sideSummary: {
      requestedFromOwner: sideSummary(prints, "requested_from_owner"),
      offeredToOwner: sideSummary(prints, "offered_to_owner"),
    },
    collectorHistory: {
      priorTrades: priorTrades.map(t => ({ tradeId: t.tradeId, status: t.status, lastUpdatedAt: t.lastUpdatedAt.toISOString() })),
      statedPreferences: preferences.map(p => ({ kind: p.kind, quote: p.quote, messageId: p.sourceMessageId })),
    },
    catalogCheckedAt: new Date().toISOString(),
  };

  const summary = `${action.replace(/_/g, " ")}: ${reason}`;
  const [evaluation] = await db.insert(schema.tradeEvaluations).values({
    ownerId,
    tradeId,
    tradeRevision: trade.currentRevision,
    recommendation: action,
    summary,
    facts,
  }).returning();

  await db.insert(schema.evidenceRefs).values(evidence.flatMap(e => e.refs.map(r => ({
    ownerId,
    subjectType: "evaluation",
    subjectId: evaluation!.id,
    evidenceType: r.type,
    refId: r.id,
    category: e.category,
    note: e.statement.slice(0, 300),
  }))));

  const recommendation: TradeRecommendation = {
    action,
    summary,
    evaluationId: evaluation!.id,
    generatedAt: evaluation!.createdAt.toISOString(),
    kind: "ai_recommendation",
  };
  const allVerified = prints.every(p => p.catalog?.rarity && p.catalog.verificationStatus === "verified");
  const anyVerified = prints.some(p => p.catalog?.rarity);
  const gives = prints.filter(p => p.inventory);
  await db.update(schema.trades).set({
    recommendation,
    rarityVerificationStatus: allVerified ? "all_verified" : anyVerified ? "partial" : "unverified",
    inventoryMatchStatus: gives.length === 0
      ? "not_applicable"
      : gives.every(p => p.inventory!.documented && p.inventory!.availability === "available")
        ? (conflicts ? "conflict" : "all_available")
        : gives.some(p => p.inventory!.documented) ? "partial" : "missing",
  }).where(eq(schema.trades.tradeId, tradeId));

  return { evaluationId: evaluation!.id, recommendation: action, summary, facts };
}
