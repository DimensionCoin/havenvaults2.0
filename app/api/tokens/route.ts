// app/api/tokens/route.ts
import { NextRequest, NextResponse } from "next/server";
import {
  tokensForCluster,
  getMintFor,
  getCluster,
  type TokenMeta,
  type TokenCategory,
} from "@/lib/tokenConfig";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type TokenSummary = {
  mint: string;
  symbol: string;
  name: string;
  logoURI: string;
  // ✅ NEW: multi-category support
  categories?: TokenCategory[];
};

type TokensApiResponse = {
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
  "DeFi",
  "Infrastructure",
  "Meme",
  "LST",
  "DePin",
  "Gaming",
  "NFT",
  "Utility",
];

// Sort by:
// 1) primary category order (first category in categories[]), unknown last
// 2) then by name
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

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = req.nextUrl;

    const pageRaw = searchParams.get("page") || "1";
    const pageSizeRaw = searchParams.get("pageSize") || "25";
    const qRaw = (searchParams.get("q") || "").trim();

    // ✅ NEW: server-side category filtering for multi-category tokens
    // e.g. "Stocks", or "all"
    const categoryRaw = (searchParams.get("category") || "").trim();

    const page = Math.max(1, Number(pageRaw) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(pageSizeRaw) || 25));

    const cluster = getCluster();
    const allForCluster = sortTokens(tokensForCluster(cluster));

    // simple search by name/symbol/id
    const q = qRaw.toLowerCase();
    let filtered = q
      ? allForCluster.filter((t) => {
          const name = t.name.toLowerCase();
          const symbol = t.symbol.toLowerCase();
          const id = (t.id || "").toLowerCase();
          return name.includes(q) || symbol.includes(q) || id.includes(q);
        })
      : allForCluster;

    // ✅ apply category filter BEFORE pagination
    if (categoryRaw && categoryRaw !== "all") {
      const allowed = new Set<TokenCategory>(CATEGORY_ORDER);

      if (allowed.has(categoryRaw as TokenCategory)) {
        const wanted = categoryRaw as TokenCategory;
        filtered = filtered.filter((t) =>
          (t.categories ?? []).includes(wanted)
        );
      }
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
          categories: t.categories ?? [],
        };
      })
      .filter(Boolean) as TokenSummary[];

    const hasMore = end < total;

    const payload: TokensApiResponse = {
      tokens,
      pagination: {
        page,
        pageSize,
        total,
        hasMore,
      },
    };

    return NextResponse.json(payload);
  } catch (error) {
    console.error("[GET /api/tokens] Error:", error);
    return NextResponse.json(
      { error: "Failed to load tokens" },
      { status: 500 }
    );
  }
}
