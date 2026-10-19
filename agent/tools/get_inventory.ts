import { defineTool } from "eve/tools";
import { z } from "zod";
import { callMiniprintTool } from "../lib/mp-internal.js";

export default defineTool({
  description: "The owner's inventory as documented from their trade-post photographs, with verified catalog data. Not a complete record of everything they own; quantity is null when the photos don't establish it.",
  inputSchema: z.object({
    availability: z.enum(["available", "traded_away", "removed"]).optional(),
    printIds: z.array(z.string().max(40)).max(50).optional(),
  }),
  execute: (input, ctx) => callMiniprintTool(ctx, "get_inventory", input),
});
