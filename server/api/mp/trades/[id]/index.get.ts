import { inArray } from "drizzle-orm";
import { db, schema } from "@nuxthub/db";
import { z } from "zod";
import { toCatalogFact } from "~~/server/utils/mp/catalog";
import { getTradeTimeline } from "~~/server/utils/mp/ledger";
import { requireSessionUserId } from "~~/server/utils/session";

export default defineEventHandler(async (event) => {
  const ownerId = await requireSessionUserId(event);
  const { id } = await getValidatedRouterParams(event, z.object({ id: z.string().uuid() }).parse);
  const timeline = await getTradeTimeline(ownerId, id);
  if (!timeline) {
    throw createError({ statusCode: 404, statusMessage: "Trade not found" });
  }
  const ids = [...new Set([
    ...timeline.revisions.flatMap(r => [...r.printsRequested, ...r.printsOffered].flatMap(l => [l.printId, ...l.candidatePrintIds])),
  ].filter((x): x is string => !!x))];
  const catalog = ids.length > 0 ? await db.select().from(schema.catalogPrints).where(inArray(schema.catalogPrints.printId, ids)) : [];
  return { ...timeline, catalog: Object.fromEntries(catalog.map(c => [c.printId, toCatalogFact(c)])) };
});
