import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// ✅ Poll Pyth every 3 seconds
crons.interval("poll pyth prices", { seconds: 3 }, internal.prices.pollPyth);

export default crons;
