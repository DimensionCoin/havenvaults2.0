import "dotenv/config";
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";

type MarketsRow = {
  id: string;
  symbol: string;
  name: string;
  image?: string;
};

type CoinsListRow = {
  id: string;
  symbol: string;
  name: string;
  platforms?: Record<string, string>; // includes contract addrs when include_platform=true
};

type OutputRow = {
  name: string;
  symbol: string;
  id: string;
  logo: string | null;
  kind: "stock" | "etf" | "tokenized_asset";
  categories: string[];
  tags: string[];
  decimals: number | null;
  mints: { mainnet?: string }; // optional, only include when known
};

const BASE = "https://api.coingecko.com/api/v3";
const DEMO_KEY = process.env.COINGECKO_DEMO_KEY;

function authHeaders(): Record<string, string> {
  const h: Record<string, string> = { accept: "application/json" };
  if (DEMO_KEY) h["x-cg-demo-api-key"] = DEMO_KEY;
  return h;
}

function kindFromName(name: string): OutputRow["kind"] {
  const n = name.toLowerCase();
  if (n.includes("ondo tokenized stock")) return "stock";
  if (n.includes("ondo tokenized etf")) return "etf";
  return "tokenized_asset";
}

function categoriesFromKind(kind: OutputRow["kind"]): string[] {
  if (kind === "stock") return ["Stocks"];
  if (kind === "etf") return ["ETFs"];
  return ["Tokenized Assets"];
}

function cleanDisplayName(name: string): string {
  return name.replace(/\s*\(Ondo Tokenized (Stock|ETF)\)\s*/i, "").trim();
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: authHeaders() });

  // Handle rate limits / auth errors more clearly
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status} ${res.statusText} on ${url}\n${body}`);
  }

  return (await res.json()) as T;
}

async function getTop200OndoTokenized(): Promise<MarketsRow[]> {
  const url =
    `${BASE}/coins/markets?vs_currency=usd` +
    `&category=ondo-tokenized-assets` +
    `&order=market_cap_desc&per_page=200&page=1` +
    `&sparkline=false`;

  return fetchJson<MarketsRow[]>(url);
}

async function getCoinsListWithPlatforms(): Promise<CoinsListRow[]> {
  const url = `${BASE}/coins/list?include_platform=true`;
  return fetchJson<CoinsListRow[]>(url);
}

async function main() {
  const [top, list] = await Promise.all([
    getTop200OndoTokenized(),
    getCoinsListWithPlatforms(),
  ]);

  const platformsById = new Map<string, Record<string, string> | undefined>();
  for (const c of list) platformsById.set(c.id, c.platforms);

  const out: OutputRow[] = top
    .map((row) => {
      const platforms = platformsById.get(row.id);
      const solMint = platforms?.solana;

      const kind = kindFromName(row.name);

      // Build mints without undefined keys
      const mints: OutputRow["mints"] = {};
      if (typeof solMint === "string" && solMint.length > 0) {
        mints.mainnet = solMint;
      }

      return {
        name: cleanDisplayName(row.name),
        symbol: row.symbol.toUpperCase(),
        id: row.id,
        logo: row.image ?? null,
        kind,
        categories: categoriesFromKind(kind),
        tags: [],
        decimals: null,
        mints,
      };
    })
    // Optional: keep only assets that actually have a Solana mint
    // .filter((x) => !!x.mints.mainnet)
    // Optional: stable order
    .sort((a, b) => a.symbol.localeCompare(b.symbol));

  // Always write file (valid JSON)
  const outPath = resolve(process.cwd(), "ondo-stocks.json");
  mkdirSync(dirname(outPath), { recursive: true });

  // Ensure trailing newline (nice for tooling)
  writeFileSync(outPath, JSON.stringify(out, null, 2) + "\n", "utf-8");

  // IMPORTANT: log to stderr so stdout stays clean if redirected
  console.error(`✅ Saved ${out.length} items to ${outPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
