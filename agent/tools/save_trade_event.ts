import { defineTool } from "eve/tools";
import { z } from "zod";
import { callMiniprintTool } from "../lib/mp-internal.js";

export default defineTool({
  description: "Record a trade offer, counteroffer, modification, or need for clarification you found in the messages. Must cite the message ids it is based on. Cannot set accepted/completed/declined/cancelled/expired — use update_trade_status for those, which requires the owner's approval.",
  inputSchema: z.object({
    conversationId: z.string().uuid(),
    tradeId: z.string().uuid().optional().describe("Existing trade to revise; omit for a new trade"),
    type: z.enum(["new_offer", "counteroffer", "modification", "clarification_needed"]),
    printsRequestedFromOwner: z.array(z.object({ label: z.string().min(1).max(200).describe("Print name as written in the messages"), quantity: z.number().int().min(1).max(100).nullable().default(null).describe("Only if stated"), printId: z.string().max(40).nullable().optional().describe("Catalog print id, only if you confirmed it with search_print_catalog") })).max(50).describe("Complete list of prints the owner would give"),
    printsOfferedToOwner: z.array(z.object({ label: z.string().min(1).max(200).describe("Print name as written in the messages"), quantity: z.number().int().min(1).max(100).nullable().default(null).describe("Only if stated"), printId: z.string().max(40).nullable().optional().describe("Catalog print id, only if you confirmed it with search_print_catalog") })).max(50).describe("Complete list of prints the owner would receive"),
    sourceMessageIds: z.array(z.string().uuid()).min(1).max(50),
    interpretation: z.string().min(1).max(600).describe("What happened and any ambiguity"),
  }),
  execute: (input, ctx) => callMiniprintTool(ctx, "save_trade_event", input),
});
