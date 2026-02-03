// lib/withApiLogging.ts
import "server-only";

import type { NextRequest } from "next/server";
import { logErrorEvent, shouldLogStatus } from "@/lib/logErrorEvent";

export function withApiLogging<Args extends readonly unknown[]>(
  route: string,
  handler: (...args: Args) => Response | void | Promise<Response | void>,
) {
  const wrapped = async (...args: Args): Promise<Response | void> => {
    const req =
      args.length > 0 &&
      args[0] != null &&
      typeof args[0] === "object" &&
      "headers" in args[0] &&
      "method" in args[0] &&
      "url" in args[0]
        ? (args[0] as NextRequest)
        : undefined;
    try {
      const res = await handler(...args);
      const status =
        res && typeof (res as Response).status === "number"
          ? (res as Response).status
          : undefined;

      const alreadyLogged =
        res &&
        typeof (res as Response).headers?.get === "function" &&
        (res as Response).headers.get("x-haven-error-logged") === "1";

      if (shouldLogStatus(status) && !alreadyLogged) {
        await logErrorEvent({
          req,
          error: `HTTP ${status}`,
          route,
          status,
        });
      }

      return res;
    } catch (err) {
      try {
        await logErrorEvent({
          req,
          error: err,
          route,
          status: 500,
        });
      } catch (logErr) {
        console.error("[withApiLogging] logErrorEvent failed:", logErr);
      }
      throw err;
    }
  };

  return wrapped;
}
