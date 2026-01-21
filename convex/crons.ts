// convex/cron.ts
import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

const PYTH_POLL_ENABLED = process.env.PYTH_POLL_ENABLED === "true";

if (PYTH_POLL_ENABLED) {
  crons.interval("poll pyth prices", { seconds: 10 }, internal.prices.pollPyth);
}

/**
 * Rate limit cleanup:
 * Deletes expired limiter windows so the table doesn't grow forever.
 *
 * 5 minutes is a good balance of cleanliness vs cost.
 */
crons.interval(
  "cleanup rate limits",
  { minutes: 10 },
  internal.rateLimit.cleanupExpired,
  { maxDeletes: 10000 }, // tune this as needed
);

export default crons;
