import { defineTool } from "eve/tools";
import { always } from "eve/tools/approval";
import { z } from "zod";
import { TRADE_STATUSES } from "../../shared/miniprint/types.js";
import { callMiniprintTool } from "../lib/mp-internal.js";

export default defineTool({
  description: "Set a trade's status as the owner's decision (e.g. accepted, completed, declined). Always asks the owner to approve first. Use only when the owner has told you the decision — never on your own recommendation. applyInventory (for completed) reduces documented quantities of the prints the owner gave.",
  inputSchema: z.object({
    tradeId: z.string().uuid(),
    status: z.enum(TRADE_STATUSES),
    notes: z.string().max(1000).optional(),
    applyInventory: z.boolean().optional(),
  }),
  // The owner must approve every status decision.
  approval: always(),
  execute: (input, ctx) => callMiniprintTool(ctx, "update_trade_status", input),
});
