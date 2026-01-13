import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

const PYTH_POLL_ENABLED = process.env.PYTH_POLL_ENABLED === "true";

if (PYTH_POLL_ENABLED) {
  crons.interval("poll pyth prices", { seconds: 4 }, internal.prices.pollPyth);
}

export default crons;
