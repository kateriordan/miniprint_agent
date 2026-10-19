import { defineTool } from "eve/tools";
import { z } from "zod";
import { callMiniprintTool } from "../lib/mp-internal.js";

export default defineTool({
  description: "Message ingestion health: whether any live source is connected (none is), last successful import, per-source coverage, known gaps, pending analysis jobs, and errors. Check this before claiming anything about how current the messages are.",
  inputSchema: z.object({}),
  execute: (input, ctx) => callMiniprintTool(ctx, "get_ingestion_status", input),
});
