import { defineTool } from "eve/tools";
import { z } from "zod";
import { callMiniprintTool } from "../lib/mp-internal.js";

export default defineTool({
  description: "Re-fetch one print's page on miniprint.io now and return its verified rarity and circulation status.",
  inputSchema: z.object({ printId: z.string().min(1).max(40).describe("Catalog print id, e.g. mp-569") }),
  execute: (input, ctx) => callMiniprintTool(ctx, "verify_print_rarity", input),
});
