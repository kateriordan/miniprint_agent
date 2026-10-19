import { and, eq } from "drizzle-orm";
import { db, schema } from "@nuxthub/db";
import { z } from "zod";
import { requireSessionUserId } from "~~/server/utils/session";

export default defineEventHandler(async (event) => {
  const ownerId = await requireSessionUserId(event);
  const { id } = await getValidatedRouterParams(event, z.object({ id: z.string().uuid() }).parse);
  const [row] = await db.select({ data: schema.inventoryImages.data, mediaType: schema.inventoryUploads.mediaType })
    .from(schema.inventoryUploads)
    .innerJoin(schema.inventoryImages, eq(schema.inventoryImages.uploadId, schema.inventoryUploads.id))
    .where(and(eq(schema.inventoryUploads.id, id), eq(schema.inventoryUploads.ownerId, ownerId)));
  if (!row) {
    throw createError({ statusCode: 404, statusMessage: "Image not found" });
  }
  setResponseHeaders(event, { "content-type": row.mediaType, "cache-control": "private, max-age=3600" });
  return row.data;
});
