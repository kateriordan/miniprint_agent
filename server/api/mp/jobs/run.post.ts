import { runJobs } from "~~/server/utils/mp/handlers";
import { requireSessionUserId } from "~~/server/utils/session";

/** Process due jobs now (yours and catalog jobs) instead of waiting for the schedule. */
export default defineEventHandler(async (event) => {
  const ownerId = await requireSessionUserId(event);
  return runJobs({ ownerId, budgetMs: 25_000 });
});
