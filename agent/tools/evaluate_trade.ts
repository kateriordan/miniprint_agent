import { defineTool } from "eve/tools";
import { z } from "zod";
import { callMiniprintTool } from "../lib/mp-internal.js";

export default defineTool({
  description: "Evaluate a trade: re-verifies each print's rarity on MiniPrint.io, checks inventory and conflicting commitments, gathers collector history and stated preferences, and returns a recommendation (accept / negotiate / decline / request clarification) with labeled evidence and uncertainties. Saves the recommendation; does not change the trade's status.",
  inputSchema: z.object({ tradeId: z.string().uuid() }),
  execute: (input, ctx) => callMiniprintTool(ctx, "evaluate_trade", input),
});
