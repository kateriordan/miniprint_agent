import { z } from "zod";
import { requireInternalRequest } from "~~/server/utils/internal-api";
import { toolDefinitions } from "~~/server/utils/mp/tools";
import type { ToolName } from "~~/server/utils/mp/tools";

const bodySchema = z.object({
  /** The eve session's authenticated principal — set by the tool wrapper, never by the model. */
  ownerId: z.string().min(1),
  input: z.unknown(),
});

export default defineEventHandler(async (event) => {
  requireInternalRequest(event);
  const name = getRouterParam(event, "name") ?? "";
  if (!(name in toolDefinitions)) {
    throw createError({ statusCode: 404, statusMessage: "Unknown tool" });
  }
  const { ownerId, input } = await readValidatedBody(event, bodySchema.parse);
  const tool = toolDefinitions[name as ToolName];
  const parsed = tool.schema.safeParse(input ?? {});
  if (!parsed.success) {
    throw createError({ statusCode: 400, statusMessage: "Invalid tool input", data: parsed.error.issues });
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (tool.run as (ownerId: string, input: any) => Promise<unknown>)(ownerId, parsed.data);
});
