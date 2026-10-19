import { z } from "zod";
import { tradeList } from "~~/server/utils/mp/views";
import { requireSessionUserId } from "~~/server/utils/session";

const querySchema = z.object({
  view: z.enum(["incoming", "opportunities", "all"]).default("all"),
  collectorId: z.string().uuid().optional(),
});

export default defineEventHandler(async (event) => {
  const ownerId = await requireSessionUserId(event);
  const { view, collectorId } = await getValidatedQuery(event, querySchema.parse);
  return tradeList(ownerId, view, collectorId);
});
