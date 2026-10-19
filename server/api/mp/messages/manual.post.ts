import { z } from "zod";
import { addManualMessage } from "~~/server/utils/mp/ingest";
import { requireSessionUserId } from "~~/server/utils/session";

const bodySchema = z.object({
  collectorName: z.string().trim().min(1).max(200),
  fromOwner: z.boolean(),
  sentAt: z.string().datetime({ offset: true }),
  text: z.string().trim().min(1).max(20_000),
});

export default defineEventHandler(async (event) => {
  const ownerId = await requireSessionUserId(event);
  const body = await readValidatedBody(event, bodySchema.parse);
  return addManualMessage(ownerId, { ...body, sentAt: new Date(body.sentAt) });
});
