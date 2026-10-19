import { z } from "zod";
import { MESSAGE_SOURCES } from "#shared/miniprint/types";
import { createImportBatch } from "~~/server/utils/mp/ingest";
import { requireSessionUserId } from "~~/server/utils/session";

const bodySchema = z.object({
  source: z.enum(MESSAGE_SOURCES).exclude(["manual_entry"]),
  label: z.string().max(200).nullable().optional(),
});

export default defineEventHandler(async (event) => {
  const ownerId = await requireSessionUserId(event);
  return { batch: await createImportBatch(ownerId, await readValidatedBody(event, bodySchema.parse)) };
});
