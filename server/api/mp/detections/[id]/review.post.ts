import { z } from "zod";
import { reviewDetection } from "~~/server/utils/mp/inventory";
import { requireSessionUserId } from "~~/server/utils/session";

const bodySchema = z.object({
  action: z.enum(["confirm", "reject", "correct"]),
  printId: z.string().max(40).nullable().optional(),
  visibleCount: z.number().int().min(1).max(100).nullable().optional(),
  notes: z.string().max(1000).nullable().optional(),
});

export default defineEventHandler(async (event) => {
  const ownerId = await requireSessionUserId(event);
  const { id } = await getValidatedRouterParams(event, z.object({ id: z.string().uuid() }).parse);
  await reviewDetection(ownerId, id, await readValidatedBody(event, bodySchema.parse));
  return { ok: true };
});
