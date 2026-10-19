import { z } from "zod";
import { getConversationContext, searchMessages } from "~~/server/utils/mp/queries";
import { requireSessionUserId } from "~~/server/utils/session";

const querySchema = z.object({
  q: z.string().max(200).optional(),
  conversationId: z.string().uuid().optional(),
  collectorId: z.string().uuid().optional(),
  around: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

export default defineEventHandler(async (event) => {
  const ownerId = await requireSessionUserId(event);
  const query = await getValidatedQuery(event, querySchema.parse);
  if (query.around) {
    return getConversationContext(ownerId, { messageId: query.around, before: 10, after: 10 });
  }
  return { messages: await searchMessages(ownerId, { query: query.q, conversationId: query.conversationId, collectorId: query.collectorId, limit: query.limit }) };
});
