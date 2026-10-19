import { getIngestionStatus } from "~~/server/utils/mp/ingest";
import { requireSessionUserId } from "~~/server/utils/session";

export default defineEventHandler(async (event) => {
  const ownerId = await requireSessionUserId(event);
  return getIngestionStatus(ownerId);
});
