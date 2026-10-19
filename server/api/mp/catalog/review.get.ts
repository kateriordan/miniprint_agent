import { getCatalogReview, getUnresolvedTradeLines } from "~~/server/utils/mp/queries";
import { db, schema } from "@nuxthub/db";
import { and, eq, inArray } from "drizzle-orm";
import { requireSessionUserId } from "~~/server/utils/session";

export default defineEventHandler(async (event) => {
  const ownerId = await requireSessionUserId(event);
  const review = await getCatalogReview();
  const unresolvedTradeLines = await getUnresolvedTradeLines(ownerId);
  const detectionsNeedingReview = await db.select().from(schema.inventoryDetections)
    .where(and(eq(schema.inventoryDetections.ownerId, ownerId), inArray(schema.inventoryDetections.reviewStatus, ["needs_review"])))
    .limit(200);
  return { ...review, unresolvedTradeLines, detectionsNeedingReview };
});
