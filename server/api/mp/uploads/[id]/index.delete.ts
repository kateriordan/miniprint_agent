import { and, eq } from "drizzle-orm";
import { db, schema } from "@nuxthub/db";
import { z } from "zod";
import { rebuildInventory } from "~~/server/utils/mp/inventory";
import { requireSessionUserId } from "~~/server/utils/session";

/** Deletes the photo and its identifications; inventory items supported only by it are removed. */
export default defineEventHandler(async (event) => {
  const ownerId = await requireSessionUserId(event);
  const { id } = await getValidatedRouterParams(event, z.object({ id: z.string().uuid() }).parse);
  await db.delete(schema.inventoryUploads).where(and(eq(schema.inventoryUploads.id, id), eq(schema.inventoryUploads.ownerId, ownerId)));
  await rebuildInventory(ownerId);
  return { ok: true };
});
