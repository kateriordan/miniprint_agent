import { z } from "zod";
import { evaluateTrade } from "~~/server/utils/mp/evaluate";
import { requireSessionUserId } from "~~/server/utils/session";

export default defineEventHandler(async (event) => {
  const ownerId = await requireSessionUserId(event);
  const { id } = await getValidatedRouterParams(event, z.object({ id: z.string().uuid() }).parse);
  return evaluateTrade(ownerId, id);
});
