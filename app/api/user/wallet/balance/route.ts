// app/api/user/wallet/balance/route.ts
import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { findTokenByMint, getCluster } from "@/lib/tokenConfig";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SOLANA_RPC =
  process.env.NEXT_PUBLIC_SOLANA_RPC || "https://api.mainnet-beta.solana.com";

// ✅ Exclude this mint entirely (don’t price it, don’t return it)
const EXCLUDED_MINT = "7GxATsNMnaC88vdwd2t3mwrFuQwwGvmYPrUQ4D6FotXk";

// REAL mainnet USDC mint
const REAL_USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

// dev/test USDC mint (or same as real on mainnet)
const LOCAL_USDC_MINT =
  process.env.USDC_MINT || process.env.NEXT_PUBLIC_USDC_MINT || REAL_USDC_MINT;

const JUP_PRICE_URL = "https://api.jup.ag/price/v3";
const JUP_API_KEY = process.env.JUP_API_KEY;

/**
 * Normalize any local/dev USDC mint to the real one for pricing
 * so we get correct prices from Jup, but we still return the
 * original mint back to the client.
 */
function normalizeMintForPricing(mint: string): string {
  if (!mint) return mint;
  if (LOCAL_USDC_MINT && mint.toLowerCase() === LOCAL_USDC_MINT.toLowerCase()) {
    return REAL_USDC_MINT;
  }
  return mint;
}

/** 🔹 Native SOL helper: lamports → SOL */
async function getNativeSolBalance(owner: string): Promise<number> {
  try {
    const res = await fetch(SOLANA_RPC, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "getBalance",
        params: [
          owner,
          {
            commitment: "confirmed",
          },
        ],
      }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.error("[wallet/balance] getBalance failed:", res.status, text);
      return 0;
    }

    const json: { result?: { value?: unknown } } = await res.json();
    const lamports = Number(json?.result?.value ?? 0);
    return Number(lamports) / 1_000_000_000;
  } catch (e) {
    console.error("[wallet/balance] getBalance error:", e);
    return 0;
  }
}

type RawTokenAccount = {
  pubkey: string;
  account: {
    data: {
      parsed: {
        info: {
          mint: string;
          tokenAmount: {
            amount: string;
            decimals: number;
            uiAmount: number | null;
            uiAmountString: string;
          };
        };
      };
    };
  };
};

async function getSplTokenPositions(owner: string) {
  const TOKEN_PROGRAM_ID = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
  const TOKEN_2022_PROGRAM_ID = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";

  async function fetchByProgram(programId: string) {
    const res = await fetch(SOLANA_RPC, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "getTokenAccountsByOwner",
        params: [
          owner,
          { programId },
          { encoding: "jsonParsed", commitment: "confirmed" },
        ],
      }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.error(
        "[wallet/balance] getTokenAccountsByOwner failed:",
        programId,
        res.status,
        text
      );
      return [] as RawTokenAccount[];
    }

    const json: { result?: { value?: RawTokenAccount[] } } = await res.json();
    return json?.result?.value ?? [];
  }

  const [classic, t22] = await Promise.all([
    fetchByProgram(TOKEN_PROGRAM_ID),
    fetchByProgram(TOKEN_2022_PROGRAM_ID),
  ]);

  const all = [...classic, ...t22];

  // (Optional but recommended) sum multiple accounts of same mint
  const byMint = new Map<
    string,
    { mint: string; uiAmount: number; decimals: number }
  >();

  for (const acc of all) {
    try {
      const info = acc.account.data.parsed.info;
      const mint: string = info.mint;
      const ta = info.tokenAmount;

      const decimals = ta.decimals;
      const ui =
        typeof ta.uiAmount === "number"
          ? ta.uiAmount
          : parseFloat(ta.uiAmountString ?? "0");

      if (!mint || !Number.isFinite(ui) || ui <= 0) continue;

      // ✅ Skip excluded mint at the source
      if (mint === EXCLUDED_MINT) continue;

      const prev = byMint.get(mint);
      if (!prev) byMint.set(mint, { mint, uiAmount: ui, decimals });
      else
        byMint.set(mint, {
          mint,
          uiAmount: prev.uiAmount + ui,
          decimals: prev.decimals,
        });
    } catch (e) {
      console.warn("[wallet/balance] failed to parse token account:", e);
    }
  }

  return Array.from(byMint.values());
}

type JupPriceEntry = {
  decimals: number;
  usdPrice: number;
  blockId: number | null;
  priceChange24h: number | null; // interpretation handled below
};

async function fetchJupPrices(
  mints: string[]
): Promise<Record<string, JupPriceEntry>> {
  // ✅ Filter excluded mint before pricing
  const normalized = mints
    .filter((m) => m && m !== EXCLUDED_MINT)
    .map(normalizeMintForPricing)
    .filter(Boolean);

  const unique = Array.from(new Set(normalized));
  if (unique.length === 0) return {};

  const url = new URL(JUP_PRICE_URL);
  url.searchParams.set("ids", unique.join(","));

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (JUP_API_KEY) headers["x-api-key"] = JUP_API_KEY;

  const res = await fetch(url.toString(), {
    method: "GET",
    headers,
    cache: "no-store",
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    console.error(
      "[wallet/balance] Jup price fetch failed:",
      res.status,
      res.statusText,
      text
    );
    return {};
  }

  const json: Record<string, JupPriceEntry> = await res.json();
  return json ?? {};
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const owner = searchParams.get("owner");

  if (!owner) {
    return NextResponse.json(
      { error: "Missing owner query parameter" },
      { status: 400 }
    );
  }

  try {
    console.log("[/api/user/wallet/balance] owner:", owner);

    // 🔹 Now we get SPL positions *and* raw native SOL
    const [splPositions, nativeSol] = await Promise.all([
      getSplTokenPositions(owner),
      getNativeSolBalance(owner),
    ]);

    // Display layer only cares about SPL tokens (incl. wSOL)
    const positions: {
      mint: string;
      uiAmount: number;
      decimals: number;
      symbol?: string;
    }[] = [...splPositions];

    if (positions.length === 0) {
      return NextResponse.json({
        owner,
        totalUsd: 0,
        totalChange24hUsd: 0,
        totalChange24hPct: 0,
        tokens: [],
        count: 0,
        nativeSol, // ⬅️ still include for SolProvider
      });
    }

    const priceMap = await fetchJupPrices(positions.map((p) => p.mint));

    type TokenOut = {
      mint: string;
      symbol?: string;
      name?: string;
      logoURI?: string | null;
      uiAmount: number;
      decimals: number;
      price?: number;
      usdValue?: number;
      priceChange24h?: number; // fraction, 0.05 = 5%
      usdChange24h?: number;
    };

    const baseTokens: TokenOut[] = [];
    let totalUsdNow = 0;
    let totalChange24hUsd = 0;

    for (const p of positions) {
      // ✅ Extra guard (even though we filtered earlier)
      if (p.mint === EXCLUDED_MINT) continue;

      const pricingMint = normalizeMintForPricing(p.mint);
      const entry = priceMap[pricingMint] as JupPriceEntry | undefined;

      const price =
        typeof entry?.usdPrice === "number" && entry.usdPrice > 0
          ? entry.usdPrice
          : undefined;

      const amount = p.uiAmount;
      let usdValue: number | undefined;
      let priceChange24h: number | undefined;
      let usdChange24h: number | undefined;

      if (price && amount > 0) {
        usdValue = Number((amount * price).toFixed(4));
        totalUsdNow += usdValue;

        if (typeof entry?.priceChange24h === "number") {
          // treat priceChange24h as % value, e.g. -5 means -5%
          const pctNumber = entry.priceChange24h;
          const c = pctNumber / 100; // → -0.05
          priceChange24h = c;

          const priorValue =
            c > -0.99 && Number.isFinite(c) ? usdValue / (1 + c) : usdValue;
          const delta = usdValue - priorValue;
          usdChange24h = Number(delta.toFixed(4));
          totalChange24hUsd += usdChange24h;
        }
      }

      baseTokens.push({
        mint: p.mint,
        symbol: p.symbol,
        uiAmount: amount,
        decimals: p.decimals,
        price,
        usdValue,
        priceChange24h,
        usdChange24h,
      });
    }

    // 🔗 Enrich from static tokenConfig
    const cluster = getCluster();
    const normalizedMints = Array.from(
      new Set(baseTokens.map((t) => normalizeMintForPricing(t.mint)))
    );

    const metaByMint = new Map<
      string,
      {
        symbol: string;
        name: string;
        logo: string;
      }
    >();

    for (const m of normalizedMints) {
      const meta = findTokenByMint(m, cluster);
      if (meta) {
        metaByMint.set(m, {
          symbol: meta.symbol,
          name: meta.name,
          logo: meta.logo,
        });
      }
    }

    const tokensEnriched: TokenOut[] = baseTokens.map((t) => {
      const key = normalizeMintForPricing(t.mint);
      const meta = metaByMint.get(key);

      return {
        ...t,
        symbol: meta?.symbol || t.symbol,
        name: meta?.name ?? t.symbol ?? t.mint,
        logoURI: meta?.logo ?? null,
      };
    });

    tokensEnriched.sort((a, b) => (b.usdValue ?? 0) - (a.usdValue ?? 0));

    const totalUsd = Number(totalUsdNow.toFixed(4));
    const totalChangeUsd = Number(totalChange24hUsd.toFixed(4));
    const prevTotal = totalUsdNow - totalChange24hUsd;
    const totalChangePct =
      prevTotal > 0 ? Number((totalChangeUsd / prevTotal).toFixed(4)) : 0;

    console.log("[/api/user/wallet/balance] summary:", {
      totalUsd,
      totalChangeUsd,
      totalChangePct,
      tokenCount: tokensEnriched.length,
      nativeSol,
    });

    return NextResponse.json({
      owner,
      totalUsd,
      totalChange24hUsd: totalChangeUsd,
      totalChange24hPct: totalChangePct,
      tokens: tokensEnriched,
      count: tokensEnriched.length,
      nativeSol, // ⬅️ key piece SolProvider needs
    });
  } catch (err) {
    console.error("[/api/user/wallet/balance] error:", err);
    return NextResponse.json(
      { error: "Failed to fetch wallet balance" },
      { status: 500 }
    );
  }
}
