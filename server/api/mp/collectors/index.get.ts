import { z } from "zod";
import { listCollectors } from "~~/server/utils/mp/queries";
import { requireSessionUserId } from "~~/server/utils/session";

export default defineEventHandler(async (event) => {
  const ownerId = await requireSessionUserId(event);
  const { q } = await getValidatedQuery(event, z.object({ q: z.string().max(100).optional() }).parse);
  return { collectors: await listCollectors(ownerId, q) };
});
