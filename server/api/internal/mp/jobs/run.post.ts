import { requireInternalRequest } from "~~/server/utils/internal-api";
import { ensureCatalogRefreshScheduled, runJobs } from "~~/server/utils/mp/handlers";

/** Called every minute by the eve schedule `agent/schedules/jobs.ts`. */
export default defineEventHandler(async (event) => {
  requireInternalRequest(event);
  await ensureCatalogRefreshScheduled();
  return runJobs({ budgetMs: 50_000 });
});
