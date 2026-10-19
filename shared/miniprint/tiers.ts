/**
 * Difficulty tiers for comparing the two sides of a trade.
 *
 * MiniPrint.io publishes the rarity values but no ranking between them. The
 * ordering below is the owner's own (stated 2026-10-18): commons are easiest
 * to get, then limited; unicorn and out-of-circulation are treated as the
 * same, hardest tier. Evaluations label it as the owner's ordering, never as
 * a catalog fact, and it is not a monetary valuation.
 */

export interface TierConfig {
  /** Rarity value (as published by MiniPrint.io) → tier number; higher is harder to get. */
  rarityTiers: Record<string, number>;
  /** Tier assigned to any print MiniPrint.io flags as out of circulation, if higher. */
  outOfCirculationTier: number | null;
  labels: Record<number, string>;
}

export const DEFAULT_TIER_CONFIG: TierConfig = {
  rarityTiers: { common: 1, limited: 2, unicorn: 3, ooc: 3 },
  outOfCirculationTier: 3,
  labels: { 1: "Common", 2: "Limited", 3: "Unicorn / OOC" },
};

/** Tier for a verified catalog record, or null when it cannot be placed. */
export function tierFor(
  rarity: string | null,
  circulationStatus: string,
  config: TierConfig = DEFAULT_TIER_CONFIG,
): number | null {
  const base = rarity ? config.rarityTiers[rarity] ?? null : null;
  const ooc = circulationStatus === "out_of_circulation" ? config.outOfCirculationTier : null;
  if (base === null && ooc === null) {
    return null;
  }
  return Math.max(base ?? 0, ooc ?? 0);
}
