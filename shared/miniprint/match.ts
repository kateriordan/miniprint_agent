/**
 * Print-name matching against the MiniPrint.io catalog.
 *
 * Harmless variation (case, accents, punctuation, "&" vs "and", a leading
 * "the") is normalized away and counts as an exact match. A small spelling
 * difference produces a *candidate* that needs review — never a verified
 * match — and only when no other print is comparably close. Numbers must
 * agree exactly, so "2024 Champions" never matches "2025 Champ".
 */

export interface MatchablePrint {
  printId: string;
  canonicalName: string;
  artist: string;
  artistSlug: string;
}

export type MatchResult =
  | { status: "verified"; printId: string; candidates: string[]; reason: string }
  | { status: "candidate"; printId: null; candidates: string[]; reason: string }
  | { status: "ambiguous"; printId: null; candidates: string[]; reason: string }
  | { status: "unmatched"; printId: null; candidates: string[]; reason: string };

export function normalizeName(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[’'`]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/^the /, "")
    .replace(/\s+/g, " ");
}

function digitTokens(normalized: string): string {
  return (normalized.match(/\d+/g) ?? []).join(",");
}

/** Optimal string alignment distance, bounded for speed. */
export function editDistance(a: string, b: string, max = 3): number {
  if (Math.abs(a.length - b.length) > max) {
    return max + 1;
  }
  const rows = a.length + 1;
  const cols = b.length + 1;
  const d: number[][] = Array.from({ length: rows }, (_, i) => {
    const row = Array.from<number>({ length: cols }).fill(0);
    row[0] = i;
    return row;
  });
  for (let j = 0; j < cols; j++) {
    d[0]![j] = j;
  }
  for (let i = 1; i < rows; i++) {
    let rowMin = Number.POSITIVE_INFINITY;
    for (let j = 1; j < cols; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let value = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        value = Math.min(value, d[i - 2]![j - 2]! + 1);
      }
      d[i]![j] = value;
      rowMin = Math.min(rowMin, value);
    }
    if (rowMin > max) {
      return max + 1;
    }
  }
  return d[a.length]![b.length]!;
}

/** Edit distance a name of this length may tolerate and still be a candidate. */
function tolerance(length: number): number {
  if (length < 5) {
    return 0;
  }
  if (length < 12) {
    return 1;
  }
  return 2;
}

export interface MatchOptions {
  /** Artist name or slug, when the source makes it clear. */
  artist?: string | null;
}

export function matchPrintName(
  label: string,
  catalog: readonly MatchablePrint[],
  options: MatchOptions = {},
): MatchResult {
  const normalized = normalizeName(label);
  if (!normalized) {
    return { status: "unmatched", printId: null, candidates: [], reason: "Empty name." };
  }

  const artistKey = options.artist ? normalizeName(options.artist) : null;
  const pool = artistKey
    ? catalog.filter(p => normalizeName(p.artist) === artistKey || normalizeName(p.artistSlug) === artistKey)
    : catalog;
  const searchPool = pool.length > 0 ? pool : catalog;

  const exact = searchPool.filter(p => normalizeName(p.canonicalName) === normalized);
  if (exact.length === 1) {
    return {
      status: "verified",
      printId: exact[0]!.printId,
      candidates: [exact[0]!.printId],
      reason: `Name matches the catalog title "${exact[0]!.canonicalName}" (${exact[0]!.artist}) after normalizing case and punctuation.`,
    };
  }
  if (exact.length > 1) {
    return {
      status: "ambiguous",
      printId: null,
      candidates: exact.map(p => p.printId),
      reason: `${exact.length} catalog prints share this title (${exact.map(p => p.artist).join(", ")}); the artist must be confirmed.`,
    };
  }

  const digits = digitTokens(normalized);
  const max = tolerance(normalized.length);
  const scored = searchPool
    .map(p => {
      const name = normalizeName(p.canonicalName);
      if (digitTokens(name) !== digits) {
        return { print: p, distance: Number.POSITIVE_INFINITY };
      }
      return { print: p, distance: editDistance(normalized, name, max + 1) };
    })
    .filter(s => s.distance <= max + 1)
    .sort((a, b) => a.distance - b.distance);

  const within = scored.filter(s => s.distance <= max);
  if (within.length === 0) {
    const contains = searchPool.filter(p => {
      const name = normalizeName(p.canonicalName);
      return normalized.length >= 4 && (name.includes(normalized) || normalized.includes(name)) && name.length >= 4;
    });
    if (contains.length > 0) {
      return {
        status: "ambiguous",
        printId: null,
        candidates: contains.slice(0, 8).map(p => p.printId),
        reason: "Only partial title overlaps were found; these are possibilities, not matches.",
      };
    }
    return { status: "unmatched", printId: null, candidates: [], reason: "No catalog title is close enough." };
  }

  const best = within[0]!;
  // A rival at the same or next distance means the spelling cannot tell the prints apart.
  const rivals = scored.filter(s => s !== best && s.distance <= best.distance + 1);
  if (rivals.length > 0) {
    return {
      status: "ambiguous",
      printId: null,
      candidates: [best, ...rivals].slice(0, 8).map(s => s.print.printId),
      reason: "Several catalog titles are similarly close; similar names are never merged automatically.",
    };
  }

  return {
    status: "candidate",
    printId: null,
    candidates: [best.print.printId],
    reason: `Close to the catalog title "${best.print.canonicalName}" (${best.distance} character difference) — needs confirmation.`,
  };
}
