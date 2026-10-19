import { defineTool } from "eve/tools";
import { z } from "zod";
import { TRADE_STATUSES } from "../../shared/miniprint/types.js";
import { callMiniprintTool } from "../lib/mp-internal.js";

export default defineTool({
  description: "List trades that are still open (or the given statuses), optionally for one collector. A recorded offer is not necessarily still active.",
  inputSchema: z.object({
    collectorId: z.string().uuid().optional(),
    collectorName: z.string().max(200).optional(),
    statuses: z.array(z.enum(TRADE_STATUSES)).optional(),
  }),
  execute: (input, ctx) => callMiniprintTool(ctx, "get_active_offers", input),
});
