// app/api/tokens/route.ts
import { NextRequest, NextResponse } from "next/server";
import {
  tokensForCluster,
  getMintFor,
  getCluster,
  TokenMeta,
  TokenCategory,
} from "@/lib/tokenConfig";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type TokenSummary = {
  mint: string;
  symbol: string;
  name: string;
  logoURI: string;
  category?: TokenCategory;
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
  "Top 3",
  "DeFi",
  "Meme",
  "Stocks",
  "LST",
  "DePin",
];

function sortTokens(tokens: TokenMeta[]): TokenMeta[] {
  return [...tokens].sort((a, b) => {
    // ✅ unknown categories should go LAST (indexOf can return -1)
    const aiRaw = a.category ? CATEGORY_ORDER.indexOf(a.category) : -1;
    const biRaw = b.category ? CATEGORY_ORDER.indexOf(b.category) : -1;

    const ai = aiRaw === -1 ? 999 : aiRaw;
    const bi = biRaw === -1 ? 999 : biRaw;

    if (ai !== bi) return ai - bi;

    // then by name
    return a.name.localeCompare(b.name);
  });
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = req.nextUrl;

    const pageRaw = searchParams.get("page") || "1";
    const pageSizeRaw = searchParams.get("pageSize") || "25";
    const qRaw = (searchParams.get("q") || "").trim();

    // ✅ NEW: server-side category filtering so pagination works per-category
    const categoryRaw = (searchParams.get("category") || "").trim(); // e.g. "Stocks"

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
          return (
            name.includes(q) || symbol.includes(q) || (id && id.includes(q))
          );
        })
      : allForCluster;

    // ✅ apply category filter BEFORE pagination
    if (categoryRaw && categoryRaw !== "all") {
      const allowed: TokenCategory[] = [
        "Top 3",
        "DeFi",
        "Meme",
        "Stocks",
        "LST",
        "DePin",
      ];

      if (allowed.includes(categoryRaw as TokenCategory)) {
        filtered = filtered.filter((t) => t.category === categoryRaw);
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
          category: t.category,
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
