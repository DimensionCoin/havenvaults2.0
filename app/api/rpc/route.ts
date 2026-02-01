// app/api/rpc/route.ts – Server-side JSON-RPC proxy
// Hides the Helius API key from the client bundle.
import "server-only";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SOLANA_RPC = process.env.SOLANA_RPC;
if (!SOLANA_RPC) {
  console.error("[rpc proxy] Missing SOLANA_RPC env var");
}

/** Methods the proxy will forward. */
const ALLOWED_METHODS = new Set([
  // Read-only
  "getAccountInfo",
  "getBalance",
  "getBlock",
  "getBlockHeight",
  "getBlockTime",
  "getClusterNodes",
  "getEpochInfo",
  "getEpochSchedule",
  "getFeeForMessage",
  "getFirstAvailableBlock",
  "getGenesisHash",
  "getHealth",
  "getHighestSnapshotSlot",
  "getIdentity",
  "getInflationGovernor",
  "getInflationRate",
  "getInflationReward",
  "getLargestAccounts",
  "getLatestBlockhash",
  "getLeaderSchedule",
  "getMinimumBalanceForRentExemption",
  "getMultipleAccounts",
  "getProgramAccounts",
  "getRecentPerformanceSamples",
  "getRecentPrioritizationFees",
  "getSignatureStatuses",
  "getSignaturesForAddress",
  "getSlot",
  "getSlotLeader",
  "getStakeActivation",
  "getStakeMinimumDelegation",
  "getSupply",
  "getTokenAccountBalance",
  "getTokenAccountsByDelegate",
  "getTokenAccountsByOwner",
  "getTokenLargestAccounts",
  "getTokenSupply",
  "getTransaction",
  "getTransactionCount",
  "getVersion",
  "getVoteAccounts",
  "isBlockhashValid",
  "minimumLedgerSlot",
  // Write (needed for client-side transaction submission)
  "sendTransaction",
  // Simulation
  "simulateTransaction",
  // Parsed variants
  "getParsedAccountInfo",
  "getParsedTransaction",
]);

/* ───────── Simple in-memory sliding-window rate limiter ───────── */

const IP_WINDOW_MS = 10_000;
const IP_MAX_REQUESTS = 40;

const ipHits = new Map<string, number[]>();

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const hits = ipHits.get(ip) ?? [];
  const recent = hits.filter((t) => now - t < IP_WINDOW_MS);
  recent.push(now);
  ipHits.set(ip, recent);
  return recent.length > IP_MAX_REQUESTS;
}

// Periodically clean up stale entries (every 60 s)
setInterval(() => {
  const now = Date.now();
  for (const [ip, hits] of ipHits) {
    const recent = hits.filter((t) => now - t < IP_WINDOW_MS);
    if (recent.length === 0) ipHits.delete(ip);
    else ipHits.set(ip, recent);
  }
}, 60_000).unref?.();

/* ───────── Helpers ───────── */

function getClientIp(req: NextRequest): string | null {
  return (
    req.headers.get("cf-connecting-ip")?.trim() ||
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip")?.trim() ||
    null
  );
}

type JsonRpcRequest = {
  jsonrpc?: string;
  method?: string;
  params?: unknown;
  id?: unknown;
};

function validateSingleRequest(
  body: unknown,
): body is JsonRpcRequest & { method: string } {
  if (typeof body !== "object" || body === null) return false;
  const r = body as Record<string, unknown>;
  return typeof r.method === "string" && r.method.length > 0;
}

/* ───────── Route handler ───────── */

export async function POST(req: NextRequest) {
  if (!SOLANA_RPC) {
    return NextResponse.json(
      { error: "RPC proxy not configured" },
      { status: 503 },
    );
  }

  // Rate limit by IP
  const ip = getClientIp(req);
  if (!ip) {
    return NextResponse.json(
      { error: "IP required for this endpoint" },
      { status: 400 },
    );
  }
  if (isRateLimited(ip)) {
    return NextResponse.json(
      { error: "Too many requests" },
      { status: 429 },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 },
    );
  }

  // Handle batch requests (array of JSON-RPC calls)
  const isBatch = Array.isArray(body);
  const requests: unknown[] = isBatch ? (body as unknown[]) : [body];

  // Validate every request in the batch
  for (const r of requests) {
    if (!validateSingleRequest(r)) {
      return NextResponse.json(
        { error: "Invalid JSON-RPC request" },
        { status: 400 },
      );
    }
    if (!ALLOWED_METHODS.has(r.method)) {
      return NextResponse.json(
        { error: `Method not allowed: ${r.method}` },
        { status: 403 },
      );
    }
  }

  // Forward to Helius
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);

    const upstream = await fetch(SOLANA_RPC, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(isBatch ? requests : requests[0]),
      signal: controller.signal,
    });

    const data = await upstream.text();

    clearTimeout(timeout);

    return new NextResponse(data, {
      status: upstream.status,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    console.error("[rpc proxy] upstream error:", err);
    const isAbort =
      (err && typeof err === "object" && (err as { name?: unknown }).name === "AbortError") ||
      (err && typeof err === "object" && (err as { code?: unknown }).code === "ERR_ABORTED") ||
      (err instanceof DOMException && err.name === "AbortError");
    if (isAbort) {
      return NextResponse.json(
        { error: "RPC proxy upstream timeout" },
        { status: 504 },
      );
    }
    return NextResponse.json(
      { error: "RPC proxy upstream error" },
      { status: 502 },
    );
  }
}
