import { z } from "zod";
import { deleteCollector } from "~~/server/utils/mp/privacy";
import { requireSessionUserId } from "~~/server/utils/session";

export default defineEventHandler(async (event) => {
  const ownerId = await requireSessionUserId(event);
  const { id } = await getValidatedRouterParams(event, z.object({ id: z.string().uuid() }).parse);
  return deleteCollector(ownerId, id);
});
