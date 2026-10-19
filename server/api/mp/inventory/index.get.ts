import { and, desc, eq, inArray } from "drizzle-orm";
import { db, schema } from "@nuxthub/db";
import { toCatalogFact } from "~~/server/utils/mp/catalog";
import { getInventory } from "~~/server/utils/mp/inventory";
import { requireSessionUserId } from "~~/server/utils/session";

export default defineEventHandler(async (event) => {
  const ownerId = await requireSessionUserId(event);
  const items = await getInventory(ownerId);
  const uploads = await db.select({
    id: schema.inventoryUploads.id,
    filename: schema.inventoryUploads.filename,
    status: schema.inventoryUploads.status,
    error: schema.inventoryUploads.error,
    createdAt: schema.inventoryUploads.createdAt,
    processedAt: schema.inventoryUploads.processedAt,
    modelId: schema.inventoryUploads.modelId,
  }).from(schema.inventoryUploads)
    .where(eq(schema.inventoryUploads.ownerId, ownerId))
    .orderBy(desc(schema.inventoryUploads.createdAt));
  const detections = await db.select().from(schema.inventoryDetections)
    .where(and(eq(schema.inventoryDetections.ownerId, ownerId)))
    .orderBy(schema.inventoryDetections.uploadId, schema.inventoryDetections.detectionIndex);
  const ids = [...new Set(detections.flatMap(d => [d.matchedPrintId, ...d.candidates.map(c => c.printId)]).filter((x): x is string => !!x))];
  const catalog = ids.length > 0 ? await db.select().from(schema.catalogPrints).where(inArray(schema.catalogPrints.printId, ids)) : [];
  return {
    items: items.map(r => ({ ...r.item, print: toCatalogFact(r.print) })),
    uploads,
    detections,
    catalog: Object.fromEntries(catalog.map(c => [c.printId, toCatalogFact(c)])),
  };
});
