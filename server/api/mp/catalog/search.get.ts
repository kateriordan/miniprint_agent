import { z } from "zod";
import { searchPrintCatalog } from "~~/server/utils/mp/queries";
import { requireSessionUserId } from "~~/server/utils/session";

export default defineEventHandler(async (event) => {
  await requireSessionUserId(event);
  const { q, artist } = await getValidatedQuery(event, z.object({ q: z.string().min(1).max(200), artist: z.string().max(100).optional() }).parse);
  return searchPrintCatalog({ query: q, artist, limit: 20 });
});
