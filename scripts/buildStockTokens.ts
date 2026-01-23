// scripts/buildStockTokens.ts
//
// Usage:
//   1) Ensure you have these files:
//        - ondo-stocks.json  (your source list)
//   2) Ensure env var is set (do NOT hardcode keys):
//        - JUP_API_KEY=...
//   3) Run:
//        - pnpm tsx scripts/buildStockTokens.ts
//        - or: npx tsx scripts/buildStockTokens.ts
//
// Outputs:
//   - ondo-stocks.jup-meta.json   (mint -> { decimals, tags })
//   - STOCK_TOKENS.ts             (export const STOCK_TOKENS: TokenMeta[] = [...])
import "dotenv/config";

import fs from "node:fs/promises";
import path from "node:path";

type OndoStockRow = {
  name: string;
  symbol: string;
  id: string;
  logo: string;
  kind: "stock" | string;
  categories: string[];
  tags?: string[];
  decimals?: number;
  mints: { mainnet: string };
};

type JupTokenInfo = {
  id: string; // mint
  name?: string;
  symbol?: string;
  icon?: string;
  decimals?: number;
  tags?: string[];
};

type JupMetaMap = Record<
  string,
  {
    decimals: number | null;
    tags: string[];
    // keep extra fields around if you ever want them later
    name?: string;
    symbol?: string;
    icon?: string;
  }
>;

type TokenMeta = {
  name: string;
  symbol: string;
  id: string;
  logo: string;
  kind: "stock";
  categories: string[];
  tags: string[];
  decimals: number;
  mints: { mainnet: string };
};

const ROOT = process.cwd();
const ONDO_FILE = path.join(ROOT, "ondo-stocks.json");
const OUT_META_FILE = path.join(ROOT, "ondo-stocks.jup-meta.json");
const OUT_TS_FILE = path.join(ROOT, "STOCK_TOKENS.ts");

const JUP_BASE = "https://api.jup.ag";
const JUP_SEARCH_PATH = "/tokens/v2/search"; // query=... (comma-separated), up to 100 mints

const API_KEY = process.env.JUP_API_KEY || "";
if (!API_KEY) {
  throw new Error(
    "Missing JUP_API_KEY in env. Add it to your .env (do NOT hardcode keys in source).",
  );
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchWithRetry(url: string, init: RequestInit, tries = 4) {
  let lastErr: unknown = null;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, init);
      if (res.ok) return res;

      // Backoff on rate limits / transient server issues
      if (res.status === 429 || (res.status >= 500 && res.status <= 599)) {
        const wait = 400 * Math.pow(2, i);
        await sleep(wait);
        lastErr = new Error(`HTTP ${res.status} on ${url}`);
        continue;
      }

      // Non-retryable
      const body = await res.text().catch(() => "");
      throw new Error(`HTTP ${res.status} on ${url}\n${body}`);
    } catch (e) {
      lastErr = e;
      const wait = 400 * Math.pow(2, i);
      await sleep(wait);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

async function fetchJupInfoForMints(mints: string[]): Promise<JupTokenInfo[]> {
  if (mints.length === 0) return [];
  if (mints.length > 100) {
    throw new Error(
      `fetchJupInfoForMints called with ${mints.length} mints (>100).`,
    );
  }

  const query = encodeURIComponent(mints.join(","));
  const url = `${JUP_BASE}${JUP_SEARCH_PATH}?query=${query}`;

  const res = await fetchWithRetry(url, {
    method: "GET",
    headers: {
      "x-api-key": API_KEY,
      accept: "application/json",
    },
  });

  const json = (await res.json()) as unknown;
  if (!Array.isArray(json)) {
    throw new Error(
      `Unexpected response from Jupiter search endpoint: ${JSON.stringify(json).slice(0, 400)}`,
    );
  }

  return json as JupTokenInfo[];
}

function normalizeTags(tags: unknown): string[] {
  // Keep the raw tags, but make them readable-ish.
  // Example tags from Jup can be: "strict", "verified", "community", etc.
  if (!Array.isArray(tags)) return [];
  return (
    tags
      .filter((t) => typeof t === "string")
      .map((t) => String(t).trim())
      .filter(Boolean)
      // Turn "toporganicscore" -> "TopOrganicscore" etc (light formatting only)
      .map((t) =>
        t
          .split(/[-_\s]+/)
          .map((s) => (s ? s[0].toUpperCase() + s.slice(1) : s))
          .join(""),
      )
      .slice(0, 10)
  );
}

function tsStringify(obj: any): string {
  // Pretty TS-safe object printing (simple + stable).
  return JSON.stringify(obj, null, 2)
    .replace(/"([^"]+)":/g, "$1:") // unquote keys
    .replace(/"([^"]+)"/g, (_, s) => `"${s.replace(/"/g, '\\"')}"`);
}

async function main() {
  const raw = await fs.readFile(ONDO_FILE, "utf8");
  const rows = JSON.parse(raw) as OndoStockRow[];

  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error("ondo-stocks.json must be a non-empty JSON array.");
  }

  const mints = rows
    .map((r) => r?.mints?.mainnet)
    .filter((m): m is string => typeof m === "string" && m.length > 0);

  const uniqueMints = Array.from(new Set(mints));
  const batches = chunk(uniqueMints, 100);

  const meta: JupMetaMap = {};
  const missing: string[] = [];

  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    const infos = await fetchJupInfoForMints(batch);

    const byMint = new Map<string, JupTokenInfo>();
    for (const info of infos) {
      if (info?.id) byMint.set(info.id, info);
    }

    for (const mint of batch) {
      const info = byMint.get(mint);
      if (!info) {
        missing.push(mint);
        meta[mint] = { decimals: null, tags: [] };
        continue;
      }

      meta[mint] = {
        decimals: typeof info.decimals === "number" ? info.decimals : null,
        tags: normalizeTags(info.tags),
        name: info.name,
        symbol: info.symbol,
        icon: info.icon,
      };
    }

    // gentle pacing if you’re doing multiple batches
    if (i < batches.length - 1) await sleep(150);
  }

  await fs.writeFile(OUT_META_FILE, JSON.stringify(meta, null, 2), "utf8");

  // Build final STOCK_TOKENS export
  const out: TokenMeta[] = rows.map((r) => {
    const mint = r.mints.mainnet;
    const j = meta[mint];

    const decimals =
      typeof r.decimals === "number" ? r.decimals : (j?.decimals ?? 8); // fallback to 8 if missing

    const tags =
      Array.isArray(r.tags) && r.tags.length > 0 ? r.tags : (j?.tags ?? []);

    return {
      name: r.name,
      symbol: r.symbol,
      id: r.id,
      logo: r.logo,
      kind: "stock",
      categories: r.categories ?? ["Stocks"],
      tags,
      decimals,
      mints: { mainnet: mint },
    };
  });

  const header = `/* eslint-disable */
// AUTO-GENERATED by scripts/buildStockTokens.ts
// Source: ondo-stocks.json + Jupiter Tokens API v2
// Do not edit by hand.

export type TokenMeta = {
  name: string;
  symbol: string;
  id: string;
  logo: string;
  kind: "stock";
  categories: string[];
  tags: string[];
  decimals: number;
  mints: { mainnet: string };
};

`;

  const body = `export const STOCK_TOKENS: TokenMeta[] = ${tsStringify(out)};\n`;

  await fs.writeFile(OUT_TS_FILE, header + body, "utf8");

  if (missing.length) {
    console.warn(
      `\n⚠️ Missing ${missing.length} mint(s) from Jup search response.\n` +
        `They were written with decimals=null in ondo-stocks.jup-meta.json and defaulted in STOCK_TOKENS.ts.\n` +
        `First few:\n${missing.slice(0, 10).join("\n")}\n`,
    );
  }

  console.log(
    `✅ Wrote:\n- ${path.relative(ROOT, OUT_META_FILE)}\n- ${path.relative(ROOT, OUT_TS_FILE)}\n`,
  );
}

main().catch((e) => {
  console.error("❌ buildStockTokens failed:", e);
  process.exit(1);
});
