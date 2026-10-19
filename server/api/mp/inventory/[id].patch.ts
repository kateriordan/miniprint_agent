import { z } from "zod";
import { updateInventoryItem } from "~~/server/utils/mp/inventory";
import { requireSessionUserId } from "~~/server/utils/session";

const bodySchema = z.object({
  quantity: z.number().int().min(0).max(1000).nullable().optional(),
  availability: z.enum(["available", "traded_away", "removed"]).optional(),
  notes: z.string().max(1000).nullable().optional(),
});

export default defineEventHandler(async (event) => {
  const ownerId = await requireSessionUserId(event);
  const { id } = await getValidatedRouterParams(event, z.object({ id: z.string().uuid() }).parse);
  await updateInventoryItem(ownerId, id, await readValidatedBody(event, bodySchema.parse));
  return { ok: true };
});
