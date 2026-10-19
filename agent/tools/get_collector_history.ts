import { defineTool } from "eve/tools";
import { z } from "zod";
import { callMiniprintTool } from "../lib/mp-internal.js";

export default defineTool({
  description: "A collector's conversations, every recorded trade and revision, and preferences they explicitly stated (with the quote and source message).",
  inputSchema: z.object({
    collectorId: z.string().uuid().optional(),
    collectorName: z.string().max(200).optional(),
  }),
  execute: (input, ctx) => callMiniprintTool(ctx, "get_collector_history", input),
});
