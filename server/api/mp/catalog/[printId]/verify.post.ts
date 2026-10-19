import { z } from "zod";
import { reverifyPrint } from "~~/server/utils/mp/catalog";
import { getPrint } from "~~/server/utils/mp/queries";
import { requireSessionUserId } from "~~/server/utils/session";

export default defineEventHandler(async (event) => {
  await requireSessionUserId(event);
  const { printId } = await getValidatedRouterParams(event, z.object({ printId: z.string().max(40) }).parse);
  const result = await reverifyPrint(printId);
  return { ...result, print: await getPrint(printId) };
});
