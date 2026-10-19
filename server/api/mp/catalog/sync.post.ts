import { requestCatalogSync } from "~~/server/utils/mp/handlers";
import { requireSessionUserId } from "~~/server/utils/session";

export default defineEventHandler(async (event) => {
  await requireSessionUserId(event);
  return requestCatalogSync();
});
