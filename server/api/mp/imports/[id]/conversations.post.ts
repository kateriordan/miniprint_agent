import { z } from "zod";
import { addConversationsToBatch, incomingConversationSchema } from "~~/server/utils/mp/ingest";
import { requireSessionUserId } from "~~/server/utils/session";

const bodySchema = z.object({ conversations: z.array(incomingConversationSchema).min(1).max(50) });

export default defineEventHandler(async (event) => {
  const ownerId = await requireSessionUserId(event);
  const { id } = await getValidatedRouterParams(event, z.object({ id: z.string().uuid() }).parse);
  const { conversations } = await readValidatedBody(event, bodySchema.parse);
  return addConversationsToBatch(ownerId, id, conversations);
});
