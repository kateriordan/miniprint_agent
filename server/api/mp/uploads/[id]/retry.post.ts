import { and, eq } from "drizzle-orm";
import { db, schema } from "@nuxthub/db";
import { z } from "zod";
import { requeueJob } from "~~/server/utils/mp/jobs";
import { requireSessionUserId } from "~~/server/utils/session";

export default defineEventHandler(async (event) => {
  const ownerId = await requireSessionUserId(event);
  const { id } = await getValidatedRouterParams(event, z.object({ id: z.string().uuid() }).parse);
  const [upload] = await db.select({ id: schema.inventoryUploads.id }).from(schema.inventoryUploads)
    .where(and(eq(schema.inventoryUploads.id, id), eq(schema.inventoryUploads.ownerId, ownerId)));
  if (!upload) {
    throw createError({ statusCode: 404, statusMessage: "Upload not found" });
  }
  await db.update(schema.inventoryUploads).set({ status: "queued", error: null }).where(eq(schema.inventoryUploads.id, id));
  await requeueJob({ kind: "inventory_identify", idempotencyKey: `identify:${id}`, ownerId, payload: { uploadId: id } });
  return { ok: true };
});
