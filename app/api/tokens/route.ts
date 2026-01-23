// app/api/tokens/route.ts
import "server-only";

import { NextRequest, NextResponse } from "next/server";
import {
  tokensForCluster,
  getMintFor,
  getCluster,
  type TokenMeta,
  type TokenCategory,
  type TokenKind,
} from "@/lib/tokenConfig";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* ───────────────── Types ───────────────── */

type TokenSummary = {
  mint: string;
  symbol: string;
  name: string;
  logoURI: string;
  kind: TokenKind;
  categories: TokenCategory[];
  tags: string[];
};

type TokensApiResponse = {
  cluster: ReturnType<typeof getCluster>;
  tokens: TokenSummary[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    hasMore: boolean;
  };
  filters: {
    availableCategories: TokenCategory[];
    availableTags: string[];
    availableKinds: Array<"all" | TokenKind>;
  };
};

/* ───────── Category ordering (stable UI buckets) ───────── */

const CATEGORY_ORDER: TokenCategory[] = [
  "Top MC",
  "Stocks",
  "PreMarket",
  "DeFi",
  "Infrastructure",
  "Meme",
  "LST",
  "DePin",
  "Gaming",
  "NFT",
  "Privacy",
  "Utility",
];

function sortTokens(tokens: TokenMeta[]): TokenMeta[] {
  return [...tokens].sort((a, b) => {
    const aPrimary = a.categories?.[0];
    const bPrimary = b.categories?.[0];

    const aiRaw = aPrimary ? CATEGORY_ORDER.indexOf(aPrimary) : -1;
    const biRaw = bPrimary ? CATEGORY_ORDER.indexOf(bPrimary) : -1;

    const ai = aiRaw === -1 ? 999 : aiRaw;
    const bi = biRaw === -1 ? 999 : biRaw;

    if (ai !== bi) return ai - bi;
    // secondary: alphabetical by name (stable enough for UX)
    return a.name.localeCompare(b.name);
  });
}

function isTokenKind(v: string): v is TokenKind {
  return v === "crypto" || v === "stock";
}

function normalizeLower(x: string | null): string {
  return (x ?? "").trim().toLowerCase();
}

function clampInt(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function buildAvailableTags(tokens: TokenMeta[]): string[] {
  const set = new Set<string>();
  for (const t of tokens) {
    for (const tag of t.tags ?? []) {
      const cleaned = tag.trim();
      if (cleaned) set.add(cleaned);
    }
  }
  // stable alphabetical
  return Array.from(set).sort((a, b) => a.localeCompare(b));
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = req.nextUrl;

    // Query params
    const page = clampInt(
      Number(searchParams.get("page") ?? 1) || 1,
      1,
      10_000,
    );
    const pageSize = clampInt(
      Number(searchParams.get("pageSize") ?? 25) || 25,
      1,
      200,
    );

    const qRaw = (searchParams.get("q") ?? "").trim();
    const categoryRaw = (searchParams.get("category") ?? "").trim();
    const kindRaw = normalizeLower(searchParams.get("kind") ?? "all");
    const tagRaw = (searchParams.get("tag") ?? "").trim();

    const cluster = getCluster();

    // Base token list (sorted for stable ordering)
    const base = sortTokens(tokensForCluster(cluster));

    // Filter metadata (for UI chips)
    const availableTags = buildAvailableTags(base);
    const availableCategories = [...CATEGORY_ORDER];
    const availableKinds: Array<"all" | TokenKind> = ["all", "crypto", "stock"];

    let filtered = base;

    // kind filter
    if (kindRaw !== "all" && isTokenKind(kindRaw)) {
      filtered = filtered.filter((t) => t.kind === kindRaw);
    }

    // search by name/symbol/id
    const q = qRaw.toLowerCase();
    if (q) {
      filtered = filtered.filter((t) => {
        const name = t.name.toLowerCase();
        const symbol = t.symbol.toLowerCase();
        const id = (t.id || "").toLowerCase();
        return name.includes(q) || symbol.includes(q) || id.includes(q);
      });
    }

    // category filter
    if (categoryRaw && categoryRaw !== "all") {
      const allowed = new Set<TokenCategory>(CATEGORY_ORDER);
      if (allowed.has(categoryRaw as TokenCategory)) {
        const wanted = categoryRaw as TokenCategory;
        filtered = filtered.filter((t) =>
          (t.categories ?? []).includes(wanted),
        );
      }
    }

    // tag filter
    if (tagRaw && tagRaw !== "all") {
      const wanted = tagRaw.toLowerCase();
      filtered = filtered.filter((t) =>
        (t.tags ?? []).some((x) => x.toLowerCase() === wanted),
      );
    }

    // pagination
    const total = filtered.length;
    const start = (page - 1) * pageSize;
    const end = start + pageSize;

    const slice = filtered.slice(start, end);

    // map to API payload (drop tokens missing mint on this cluster)
    const tokens: TokenSummary[] = slice
      .map((t) => {
        const mint = getMintFor(t, cluster);
        if (!mint) return null;

        return {
          mint,
          symbol: t.symbol,
          name: t.name,
          logoURI: t.logo,
          kind: t.kind,
          categories: t.categories ?? [],
          tags: t.tags ?? [],
        };
      })
      .filter(Boolean) as TokenSummary[];

    const payload: TokensApiResponse = {
      cluster,
      tokens,
      pagination: {
        page,
        pageSize,
        total,
        hasMore: end < total,
      },
      filters: {
        availableCategories,
        availableTags,
        availableKinds,
      },
    };

    return NextResponse.json(payload, {
      headers: {
        // static-ish catalog → safe to cache
        "Cache-Control": "public, max-age=300, stale-while-revalidate=3600",
      },
    });
  } catch (error) {
    console.error("[GET /api/tokens] Error:", error);
    return NextResponse.json(
      { error: "Failed to load tokens" },
      { status: 500 },
    );
  }
}
