import { z } from "zod";
import { getCollectorHistory } from "~~/server/utils/mp/queries";
import { requireSessionUserId } from "~~/server/utils/session";

export default defineEventHandler(async (event) => {
  const ownerId = await requireSessionUserId(event);
  const { id } = await getValidatedRouterParams(event, z.object({ id: z.string().uuid() }).parse);
  return getCollectorHistory(ownerId, id);
});
