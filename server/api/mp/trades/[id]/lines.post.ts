import { z } from "zod";
import { ownerCorrectTradeLines } from "~~/server/utils/mp/ledger";
import { requireSessionUserId } from "~~/server/utils/session";

const line = z.object({
  label: z.string().trim().min(1).max(200),
  quantity: z.number().int().min(1).max(100).nullable(),
  printId: z.string().max(40).nullable().optional(),
});

const bodySchema = z.object({
  printsRequested: z.array(line).max(50).optional(),
  printsOffered: z.array(line).max(50).optional(),
  notes: z.string().max(2000).nullable().optional(),
});

export default defineEventHandler(async (event) => {
  const ownerId = await requireSessionUserId(event);
  const { id } = await getValidatedRouterParams(event, z.object({ id: z.string().uuid() }).parse);
  const body = await readValidatedBody(event, bodySchema.parse);
  return ownerCorrectTradeLines(ownerId, id, body);
});
