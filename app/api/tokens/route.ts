// app/api/tokens/route.ts
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

type TokenSummary = {
  mint: string;
  symbol: string;
  name: string;
  logoURI: string;
  kind: TokenKind;
  categories: TokenCategory[];
  tags?: string[];
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
};

// ✅ include ALL categories so ordering is stable
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
    return a.name.localeCompare(b.name);
  });
}

function isTokenKind(v: string): v is TokenKind {
  return v === "crypto" || v === "stock";
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = req.nextUrl;

    const pageRaw = searchParams.get("page") || "1";
    const pageSizeRaw = searchParams.get("pageSize") || "25";
    const qRaw = (searchParams.get("q") || "").trim();
    const categoryRaw = (searchParams.get("category") || "").trim();
    const kindRaw = (searchParams.get("kind") || "all").trim().toLowerCase();
    const tagRaw = (searchParams.get("tag") || "").trim(); // ✅ NEW

    const page = Math.max(1, Number(pageRaw) || 1);
    const pageSize = Math.min(200, Math.max(1, Number(pageSizeRaw) || 25)); // ✅ allow bigger lists
    const cluster = getCluster();

    let filtered = sortTokens(tokensForCluster(cluster));

    // ✅ kind filter
    if (kindRaw !== "all" && isTokenKind(kindRaw)) {
      filtered = filtered.filter((t) => t.kind === kindRaw);
    }

    // ✅ search by name/symbol/id
    const q = qRaw.toLowerCase();
    if (q) {
      filtered = filtered.filter((t) => {
        const name = t.name.toLowerCase();
        const symbol = t.symbol.toLowerCase();
        const id = (t.id || "").toLowerCase();
        return name.includes(q) || symbol.includes(q) || id.includes(q);
      });
    }

    // ✅ category filter
    if (categoryRaw && categoryRaw !== "all") {
      const allowed = new Set<TokenCategory>(CATEGORY_ORDER);
      if (allowed.has(categoryRaw as TokenCategory)) {
        const wanted = categoryRaw as TokenCategory;
        filtered = filtered.filter((t) =>
          (t.categories ?? []).includes(wanted),
        );
      }
    }

    // ✅ tag filter (secondary chips)
    if (tagRaw && tagRaw !== "all") {
      const wanted = tagRaw.toLowerCase();
      filtered = filtered.filter((t) =>
        (t.tags ?? []).some((x) => x.toLowerCase() === wanted),
      );
    }

    const total = filtered.length;
    const start = (page - 1) * pageSize;
    const end = start + pageSize;

    const slice = filtered.slice(start, end);

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
    };

    // ✅ Cache: fast UX after first load, still safe since tokens are basically static
    return NextResponse.json(payload, {
      headers: {
        // cache in browser for 5 min, allow stale while revalidating for 1 hour
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
