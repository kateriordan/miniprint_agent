import { z } from "zod";
import { failImportBatch } from "~~/server/utils/mp/ingest";
import { requireSessionUserId } from "~~/server/utils/session";

export default defineEventHandler(async (event) => {
  const ownerId = await requireSessionUserId(event);
  const { id } = await getValidatedRouterParams(event, z.object({ id: z.string().uuid() }).parse);
  const { reason } = await readValidatedBody(event, z.object({ reason: z.string().max(500) }).parse);
  await failImportBatch(ownerId, id, reason);
  return { ok: true };
});
