import { z } from "zod";
import { retryJob } from "~~/server/utils/mp/jobs";
import { requireSessionUserId } from "~~/server/utils/session";

export default defineEventHandler(async (event) => {
  const ownerId = await requireSessionUserId(event);
  const { id } = await getValidatedRouterParams(event, z.object({ id: z.string().uuid() }).parse);
  await retryJob(id, ownerId);
  return { ok: true };
});
