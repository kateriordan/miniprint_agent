import { z } from "zod";
import { deleteAllMessageData } from "~~/server/utils/mp/privacy";
import { requireSessionUserId } from "~~/server/utils/session";

/** Deletes every imported message and all trades, collectors and evidence derived from them. */
export default defineEventHandler(async (event) => {
  const ownerId = await requireSessionUserId(event);
  await readValidatedBody(event, z.object({ confirm: z.literal("DELETE ALL MESSAGES") }).parse);
  return deleteAllMessageData(ownerId);
});
