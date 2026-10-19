import { z } from "zod";
import { addInventoryItemManually } from "~~/server/utils/mp/inventory";
import { requireSessionUserId } from "~~/server/utils/session";

const bodySchema = z.object({
  printId: z.string().min(1).max(40),
  quantity: z.number().int().min(0).max(1000).nullable(),
  notes: z.string().max(1000).nullable().optional(),
});

export default defineEventHandler(async (event) => {
  const ownerId = await requireSessionUserId(event);
  await addInventoryItemManually(ownerId, await readValidatedBody(event, bodySchema.parse));
  return { ok: true };
});
