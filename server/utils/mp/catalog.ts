/**
 * MiniPrint.io catalog access.
 *
 * MiniPrint.io publishes no API. Its public print pages are statically
 * generated and embed each print's catalog record (title, artist, rarity,
 * out-of-circulation flag) in the page's `__NEXT_DATA__` JSON; robots.txt
 * allows crawling (`Allow: /`, only literal route templates disallowed) and the
 * Terms of Use do not restrict reading public pages. We read only public,
 * unauthenticated pages, identify ourselves, cache results in the database,
 * and pace requests.
 *
 * Verification rule: a print is `verified` only when its own detail page
 * (`/prints/<artist>/<slug>`) was fetched and parsed. Listing pages are used
 * for discovery only.
 */
import { and, eq, inArray, lt, or, isNull, sql } from "drizzle-orm";
import { db, schema } from "@nuxthub/db";
import { z } from "zod";
import type { MatchablePrint } from "#shared/miniprint/match";

const ORIGIN = "https://miniprint.io";
const USER_AGENT = "MiniPrintTradeAgent/0.1 (personal trade-tracking tool; reads public catalog pages)";
const REQUEST_SPACING_MS = 1_100;
/** Records older than this are re-fetched before a trade evaluation uses them. */
export const EVALUATION_MAX_AGE_MS = 24 * 60 * 60 * 1000;
/** Records older than this show as needing refresh. */
export const STALE_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

let lastRequestAt = 0;

async function politeFetch(url: string): Promise<Response> {
  if (!url.startsWith(`${ORIGIN}/`)) {
    throw new Error(`Refusing to fetch outside ${ORIGIN}`);
  }
  const wait = lastRequestAt + REQUEST_SPACING_MS - Date.now();
  if (wait > 0) {
    await new Promise(resolve => setTimeout(resolve, wait));
  }
  lastRequestAt = Date.now();
  return fetch(url, {
    headers: { "user-agent": USER_AGENT, accept: "text/html,application/xml" },
    redirect: "follow",
    signal: AbortSignal.timeout(20_000),
  });
}

function extractNextData(html: string): { buildId?: string; props?: { pageProps?: unknown } } {
  const match = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!match) {
    throw new Error("Page did not contain catalog data (__NEXT_DATA__ missing).");
  }
  return JSON.parse(match[1]!);
}

const detailSchema = z.object({
  print: z.object({
    id: z.number().int(),
    title: z.string().min(1),
    slug: z.string().min(1),
    rarity: z.string().nullable().optional(),
    is_ooc: z.boolean().nullable().optional(),
    collection: z.string().nullable().optional(),
    img_url: z.string().nullable().optional(),
  }),
  artist: z.object({
    slug: z.string().min(1),
    name: z.string().min(1),
  }),
});

const listingSchema = z.object({
  prints: z.array(z.object({
    id: z.number().int().optional(),
    title: z.string(),
    slug: z.string().optional(),
  })),
});

export interface FetchedPrint {
  miniprintId: number;
  canonicalName: string;
  artist: string;
  artistSlug: string;
  slug: string;
  rarity: string | null;
  circulationStatus: "out_of_circulation" | "in_circulation" | "unknown";
  collection: string | null;
  imageUrl: string | null;
  catalogUrl: string;
  buildId: string | null;
  snapshot: Record<string, unknown>;
}

export function printIdFor(miniprintId: number) {
  return `mp-${miniprintId}`;
}

export function catalogUrlFor(artistSlug: string, slug: string) {
  return `${ORIGIN}/prints/${artistSlug}/${slug}`;
}

/** Parse a print detail page. Exported for tests. */
export function parsePrintPage(html: string, url: string): FetchedPrint {
  const data = extractNextData(html);
  const parsed = detailSchema.safeParse(data.props?.pageProps);
  if (!parsed.success) {
    throw new Error(`Unrecognized print page structure at ${url}`);
  }
  const { print, artist } = parsed.data;
  const rarity = print.rarity?.trim() ? print.rarity.trim().toLowerCase() : null;
  return {
    miniprintId: print.id,
    canonicalName: print.title,
    artist: artist.name,
    artistSlug: artist.slug,
    slug: print.slug,
    rarity,
    circulationStatus: print.is_ooc === true ? "out_of_circulation" : print.is_ooc === false ? "in_circulation" : "unknown",
    collection: print.collection ?? null,
    imageUrl: print.img_url ?? null,
    catalogUrl: catalogUrlFor(artist.slug, print.slug),
    buildId: data.buildId ?? null,
    snapshot: {
      id: print.id,
      title: print.title,
      rarity: print.rarity ?? null,
      is_ooc: print.is_ooc ?? null,
      collection: print.collection ?? null,
      artist: artist.name,
      url,
    },
  };
}

export async function fetchPrintPage(url: string): Promise<FetchedPrint> {
  const response = await politeFetch(url);
  if (response.status === 404) {
    throw new CatalogNotFoundError(url);
  }
  if (!response.ok) {
    throw new Error(`miniprint.io returned ${response.status} for ${url}`);
  }
  return parsePrintPage(await response.text(), url);
}

export class CatalogNotFoundError extends Error {
  constructor(public url: string) {
    super(`Catalog page not found: ${url}`);
  }
}

async function upsertVerified(p: FetchedPrint) {
  const now = new Date();
  const values = {
    printId: printIdFor(p.miniprintId),
    miniprintId: p.miniprintId,
    canonicalName: p.canonicalName,
    artist: p.artist,
    artistSlug: p.artistSlug,
    slug: p.slug,
    rarity: p.rarity,
    circulationStatus: p.circulationStatus,
    collection: p.collection,
    catalogUrl: p.catalogUrl,
    imageUrl: p.imageUrl,
    verifiedAt: now,
    // A page without a rarity value is a real catalog record with unverified rarity.
    verificationStatus: p.rarity ? "verified" : "rarity_missing",
    sourceBuildId: p.buildId,
    sourceSnapshot: p.snapshot,
  };
  await db.insert(schema.catalogPrints)
    .values(values)
    .onConflictDoUpdate({ target: schema.catalogPrints.printId, set: { ...values, updatedAt: now } });
  invalidateMatchCache();
}

/** Discover every print URL from the sitemap and the artist listing pages. */
async function discoverPrintUrls(errors: string[]): Promise<{ urls: Set<string>; pages: number }> {
  const urls = new Set<string>();
  let pages = 0;

  const sitemap = await politeFetch(`${ORIGIN}/sitemap.xml`);
  pages++;
  if (!sitemap.ok) {
    throw new Error(`sitemap.xml returned ${sitemap.status}`);
  }
  const xml = await sitemap.text();
  const artistSlugs = new Set<string>();
  for (const m of xml.matchAll(/<loc>([^<]+)<\/loc>/g)) {
    const loc = m[1]!.trim();
    if (/^https:\/\/miniprint\.io\/prints\/[^/]+\/[^/]+$/.test(loc)) {
      urls.add(loc);
    }
    const artist = loc.match(/^https:\/\/miniprint\.io\/artists\/([^/]+)$/);
    if (artist) {
      artistSlugs.add(artist[1]!);
    }
  }

  // Listing pages can include prints the sitemap lags behind on.
  for (const slug of artistSlugs) {
    try {
      const res = await politeFetch(`${ORIGIN}/artists/${slug}`);
      pages++;
      if (!res.ok) {
        errors.push(`artists/${slug}: HTTP ${res.status}`);
        continue;
      }
      const listing = listingSchema.safeParse(extractNextData(await res.text()).props?.pageProps);
      if (!listing.success) {
        errors.push(`artists/${slug}: listing structure not recognized`);
        continue;
      }
      for (const p of listing.data.prints) {
        if (p.slug) {
          urls.add(catalogUrlFor(slug, p.slug));
        }
      }
    }
    catch (error) {
      errors.push(`artists/${slug}: ${(error as Error).message}`);
    }
  }
  return { urls, pages };
}

/**
 * Start a full catalog sync: discover URLs, then queue verification batches.
 * Fetching ~1,000 pages at a polite pace takes ~20 minutes, so the work is
 * spread across jobs instead of one long request.
 */
export async function startCatalogSync(enqueue: (urls: string[], runId: number, index: number) => Promise<void>) {
  const [run] = await db.insert(schema.catalogSyncRuns).values({ mode: "full" }).returning();
  const errors: string[] = [];
  try {
    const { urls, pages } = await discoverPrintUrls(errors);
    const known = await db.select({ url: schema.catalogPrints.catalogUrl, printId: schema.catalogPrints.printId })
      .from(schema.catalogPrints);
    const missing = known.filter(k => !urls.has(k.url));
    if (missing.length > 0) {
      await db.update(schema.catalogPrints)
        .set({ verificationStatus: "missing_from_source" })
        .where(inArray(schema.catalogPrints.printId, missing.map(m => m.printId)));
    }

    const list = [...urls].sort();
    const BATCH = 40;
    for (let i = 0; i < list.length; i += BATCH) {
      await enqueue(list.slice(i, i + BATCH), run!.id, i / BATCH);
    }
    await db.update(schema.catalogSyncRuns).set({
      pagesFetched: pages,
      printsMissing: missing.length,
      errors,
      status: list.length > 0 ? "verifying" : "succeeded",
    }).where(eq(schema.catalogSyncRuns.id, run!.id));
    return { runId: run!.id, discovered: list.length, missing: missing.length };
  }
  catch (error) {
    await db.update(schema.catalogSyncRuns).set({
      status: "failed",
      finishedAt: new Date(),
      errors: [...errors, (error as Error).message],
    }).where(eq(schema.catalogSyncRuns.id, run!.id));
    throw error;
  }
}

/** Verify a batch of detail pages. Each page succeeds or fails on its own. */
export async function verifyCatalogUrls(urls: string[], runId: number | null, deadline: number) {
  let done = 0;
  const errors: string[] = [];
  const remaining: string[] = [];
  for (const url of urls) {
    if (Date.now() > deadline) {
      remaining.push(url);
      continue;
    }
    try {
      await upsertVerified(await fetchPrintPage(url));
      done++;
    }
    catch (error) {
      if (error instanceof CatalogNotFoundError) {
        await db.update(schema.catalogPrints)
          .set({ verificationStatus: "missing_from_source" })
          .where(eq(schema.catalogPrints.catalogUrl, url));
      }
      errors.push(`${url}: ${(error as Error).message}`);
    }
  }
  if (runId !== null) {
    await db.update(schema.catalogSyncRuns).set({
      pagesFetched: sql`${schema.catalogSyncRuns.pagesFetched} + ${done + errors.length}`,
      printsUpserted: sql`${schema.catalogSyncRuns.printsUpserted} + ${done}`,
      errors: sql`${schema.catalogSyncRuns.errors} || ${JSON.stringify(errors.slice(0, 20))}::jsonb`,
    }).where(eq(schema.catalogSyncRuns.id, runId));
  }
  return { verified: done, errors, remaining };
}

export async function finishSyncRunIfDone(runId: number, pendingBatches: number) {
  if (pendingBatches === 0) {
    await db.update(schema.catalogSyncRuns)
      .set({ status: "succeeded", finishedAt: new Date() })
      .where(and(eq(schema.catalogSyncRuns.id, runId), eq(schema.catalogSyncRuns.status, "verifying")));
  }
}

/** Re-fetch one print's page now. Used before evaluating a trade. */
export async function reverifyPrint(printId: string) {
  const [row] = await db.select().from(schema.catalogPrints).where(eq(schema.catalogPrints.printId, printId)).limit(1);
  if (!row) {
    return { ok: false as const, error: "Print is not in the local catalog." };
  }
  try {
    const fetched = await fetchPrintPage(row.catalogUrl);
    if (fetched.miniprintId !== row.miniprintId) {
      await db.update(schema.catalogPrints).set({ verificationStatus: "conflict" }).where(eq(schema.catalogPrints.printId, printId));
      return { ok: false as const, error: "The catalog URL now points to a different print; marked for review." };
    }
    await upsertVerified(fetched);
    return { ok: true as const };
  }
  catch (error) {
    if (error instanceof CatalogNotFoundError) {
      await db.update(schema.catalogPrints).set({ verificationStatus: "missing_from_source" }).where(eq(schema.catalogPrints.printId, printId));
    }
    return { ok: false as const, error: (error as Error).message };
  }
}

export async function ensureFresh(printIds: string[], maxAgeMs = EVALUATION_MAX_AGE_MS) {
  if (printIds.length === 0) {
    return [];
  }
  const cutoff = new Date(Date.now() - maxAgeMs);
  const stale = await db.select({ printId: schema.catalogPrints.printId })
    .from(schema.catalogPrints)
    .where(and(
      inArray(schema.catalogPrints.printId, printIds),
      or(isNull(schema.catalogPrints.verifiedAt), lt(schema.catalogPrints.verifiedAt, cutoff)),
    ));
  const failures: Array<{ printId: string; error: string }> = [];
  for (const { printId } of stale) {
    const result = await reverifyPrint(printId);
    if (!result.ok) {
      failures.push({ printId, error: result.error });
    }
  }
  return failures;
}

let matchCache: { at: number; rows: MatchablePrint[] } | null = null;

export function invalidateMatchCache() {
  matchCache = null;
}

/** Catalog rows used for name matching. Excludes prints missing from the source. */
export async function getMatchableCatalog(): Promise<MatchablePrint[]> {
  if (matchCache && Date.now() - matchCache.at < 5 * 60_000) {
    return matchCache.rows;
  }
  const rows = await db.select({
    printId: schema.catalogPrints.printId,
    canonicalName: schema.catalogPrints.canonicalName,
    artist: schema.catalogPrints.artist,
    artistSlug: schema.catalogPrints.artistSlug,
  }).from(schema.catalogPrints)
    .where(sql`${schema.catalogPrints.verificationStatus} not in ('missing_from_source', 'conflict')`);
  matchCache = { at: Date.now(), rows };
  return rows;
}

export function toCatalogFact(row: typeof schema.catalogPrints.$inferSelect) {
  return {
    printId: row.printId,
    canonicalName: row.canonicalName,
    artist: row.artist,
    rarity: row.verificationStatus === "verified" ? row.rarity : null,
    circulationStatus: row.circulationStatus,
    catalogUrl: row.catalogUrl,
    imageUrl: row.imageUrl,
    collection: row.collection,
    verifiedAt: row.verifiedAt?.toISOString() ?? null,
    verificationStatus: row.verifiedAt && Date.now() - row.verifiedAt.getTime() > STALE_AFTER_MS && row.verificationStatus === "verified"
      ? "stale"
      : row.verificationStatus,
  };
}
