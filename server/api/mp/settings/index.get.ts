import { getOwnerSettings } from "~~/server/utils/mp/settings";
import { requireSessionUserId } from "~~/server/utils/session";

export default defineEventHandler(async (event) => {
  const ownerId = await requireSessionUserId(event);
  return getOwnerSettings(ownerId);
});
