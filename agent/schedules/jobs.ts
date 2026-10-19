import { defineSchedule } from "eve/schedules";
import { appOrigin, internalHeaders } from "../lib/internal-api.js";

/**
 * Drives the durable job queue (catalog sync, photo identification, message
 * analysis) once a minute. The work itself is deterministic app code with
 * leases, retries and idempotency keys in Postgres; this only wakes it up.
 * `eve dev` does not fire schedules — use "Run pending jobs" on the System
 * Health page, or POST /eve/v1/dev/schedules/jobs.
 */
export default defineSchedule({
  cron: "* * * * *",
  run({ waitUntil }) {
    waitUntil((async () => {
      const response = await fetch(`${appOrigin()}/api/internal/mp/jobs/run`, {
        method: "POST",
        headers: internalHeaders(),
        signal: AbortSignal.timeout(58_000),
      });
      if (!response.ok) {
        console.error(`[mp-jobs] runner returned ${response.status}`);
      }
    })());
  },
});
