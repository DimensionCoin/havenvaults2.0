// lib/privyServer.ts
import "server-only";
import { PrivyClient } from "@privy-io/server-auth";

const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID;
const appSecret = process.env.PRIVY_APP_SECRET;

if (!appId || !appSecret) {
  throw new Error("Missing NEXT_PUBLIC_PRIVY_APP_ID or PRIVY_APP_SECRET");
}

// ✅ Correct constructor: (appId, appSecret, options?)
export const privyServerClient = new PrivyClient(appId, appSecret);
