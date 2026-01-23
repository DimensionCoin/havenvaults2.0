import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

const JUP_API_KEY = required("JUP_API_KEY");
const JUP_QUOTE = "https://api.jup.ag/swap/v1/quote";

async function jupFetch(url: string) {
  return fetch(url, {
    cache: "no-store",
    headers: {
      "x-api-key": JUP_API_KEY,
    },
  });
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as {
    inputMint?: string;
    outputMint?: string;
    amount?: string | number; // base units
    slippageBps?: number;
  } | null;

  const inputMint = String(body?.inputMint || "");
  const outputMint = String(body?.outputMint || "");
  const amountRaw = body?.amount;

  const slippageBps = Math.max(
    1,
    Math.min(2000, Number(body?.slippageBps ?? 50)),
  );

  if (!inputMint || !outputMint || inputMint === outputMint) {
    return NextResponse.json({ error: "Invalid mint pair." }, { status: 400 });
  }

  const amount =
    typeof amountRaw === "number"
      ? String(Math.floor(amountRaw))
      : String(amountRaw || "");
  if (!/^\d+$/.test(amount) || Number(amount) <= 0) {
    return NextResponse.json({ error: "Invalid amount." }, { status: 400 });
  }

  const url =
    `${JUP_QUOTE}?` +
    new URLSearchParams({
      inputMint,
      outputMint,
      amount,
      slippageBps: String(slippageBps),
    });

  const res = await jupFetch(url);
  const text = await res.text().catch(() => "");
  if (!res.ok) {
    return NextResponse.json(
      {
        error: `Quote failed (HTTP ${res.status})`,
        details: text.slice(0, 400),
      },
      { status: res.status },
    );
  }

  const json: {
    routePlan?: Array<{ swapInfo?: { label?: unknown } }>;
    outAmount?: unknown;
    otherAmountThreshold?: unknown;
    priceImpactPct?: unknown;
  } = text ? JSON.parse(text) : {};

  const labels = Array.isArray(json.routePlan)
    ? json.routePlan
        .map((p) =>
          typeof p?.swapInfo?.label === "string" ? p.swapInfo.label : null,
        )
        .filter((lbl): lbl is string => typeof lbl === "string")
    : [];

  return NextResponse.json({
    outAmount: String(json.outAmount || "0"),
    otherAmountThreshold: String(json.otherAmountThreshold || "0"),
    priceImpactPct:
      typeof json.priceImpactPct === "string" ? json.priceImpactPct : null,
    routeLabels: labels,
  });
}
