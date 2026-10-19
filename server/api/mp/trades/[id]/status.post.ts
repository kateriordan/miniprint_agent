import { z } from "zod";
import { TRADE_STATUSES } from "#shared/miniprint/types";
import { ownerSetTradeStatus } from "~~/server/utils/mp/ledger";
import { requireSessionUserId } from "~~/server/utils/session";

const bodySchema = z.object({
  status: z.enum(TRADE_STATUSES),
  notes: z.string().max(2000).nullable().optional(),
  applyInventory: z.boolean().optional(),
});

/** The owner's own status decision. This is the only path to accepted/completed besides an approved agent call. */
export default defineEventHandler(async (event) => {
  const ownerId = await requireSessionUserId(event);
  const { id } = await getValidatedRouterParams(event, z.object({ id: z.string().uuid() }).parse);
  const body = await readValidatedBody(event, bodySchema.parse);
  return ownerSetTradeStatus(ownerId, id, body);
});
