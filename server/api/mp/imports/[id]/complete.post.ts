import { z } from "zod";
import { completeImportBatch } from "~~/server/utils/mp/ingest";
import { requireSessionUserId } from "~~/server/utils/session";

export default defineEventHandler(async (event) => {
  const ownerId = await requireSessionUserId(event);
  const { id } = await getValidatedRouterParams(event, z.object({ id: z.string().uuid() }).parse);
  const { warnings } = await readValidatedBody(event, z.object({ warnings: z.array(z.string().max(500)).max(500).default([]) }).parse);
  return completeImportBatch(ownerId, id, warnings);
});
