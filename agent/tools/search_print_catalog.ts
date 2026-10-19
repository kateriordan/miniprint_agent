import { defineTool } from "eve/tools";
import { z } from "zod";
import { callMiniprintTool } from "../lib/mp-internal.js";

export default defineTool({
  description: "Search the local copy of the MiniPrint.io catalog by print name. Returns match status (verified / candidate / ambiguous / unmatched) and catalog records. MiniPrint.io is the only source of rarity — never state a rarity that is not in a result.",
  inputSchema: z.object({
    query: z.string().min(1).max(200),
    artist: z.string().max(100).optional(),
  }),
  execute: (input, ctx) => callMiniprintTool(ctx, "search_print_catalog", input),
});
