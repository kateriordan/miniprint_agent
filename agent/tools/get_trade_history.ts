import { defineTool } from "eve/tools";
import { z } from "zod";
import { callMiniprintTool } from "../lib/mp-internal.js";

export default defineTool({
  description: "Full history of one trade: every revision, the original supporting messages, and past evaluations.",
  inputSchema: z.object({ tradeId: z.string().uuid() }),
  execute: (input, ctx) => callMiniprintTool(ctx, "get_trade_history", input),
});
