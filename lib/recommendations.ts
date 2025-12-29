// lib/recommendations.ts
import type { AppUser } from "@/providers/UserProvider";
import type { WalletToken } from "@/providers/BalanceProvider";
import {
  TOKENS,
  type TokenMeta,
  type TokenCategory,
  getCluster,
  getMintFor,
  findTokenByMint,
} from "@/lib/tokenConfig";

export type TokenRecommendation = {
  token: TokenMeta;
  score: number;
  reasons: string[];
};

type RiskLevel = "low" | "medium" | "high";
type KnowledgeLevel = "none" | "beginner" | "intermediate" | "advanced";

type Segment = "conservative" | "balanced" | "growth" | "degen";

type SegmentConfig = {
  /** Categories this segment is allowed to see at all */
  allowedCategories: TokenCategory[];
  /** How much this segment “likes” each category */
  categoryWeights: Partial<Record<TokenCategory, number>>;
  /** Whether memecoins are allowed */
  includeMemes: boolean;
};

type SegmentCategoryCaps = Partial<Record<TokenCategory, number>>; // 0–1 fraction
type SegmentPriorityOrder = TokenCategory[];

const categoryLabels: Record<TokenCategory, string> = {
  "Top 3": "blue-chip crypto",
  DeFi: "DeFi",
  Meme: "memecoins",
  Stocks: "stocks",
  LST: "staked SOL (LSTs)",
  DePin: "DePin",
};

/* ─────────────────────────────────────────────
 * Segment configs – category preferences only
 * ─────────────────────────────────────────── */

const SEGMENT_CONFIG: Record<Segment, SegmentConfig> = {
  // Low risk + low experience: keep them boring
  conservative: {
    allowedCategories: ["Stocks", "Top 3"],
    categoryWeights: {
      Stocks: 3,
      "Top 3": 1.5,
      LST: 0,
      DeFi: 0,
      DePin: 0,
      Meme: -10,
    },
    includeMemes: false,
  },

  // Low risk but some experience; or med risk with low experience
  balanced: {
    allowedCategories: ["Stocks", "Top 3", "LST"],
    categoryWeights: {
      Stocks: 3,
      "Top 3": 2,
      LST: 2,
      DeFi: 0.5,
      DePin: 0.5,
      Meme: -8,
    },
    includeMemes: false,
  },

  // Medium/high risk with some experience → add DeFi + DePin
  growth: {
    allowedCategories: ["Top 3", "LST", "DeFi", "DePin", "Stocks"],
    categoryWeights: {
      "Top 3": 2,
      LST: 2,
      DeFi: 3,
      DePin: 3,
      Stocks: 1,
      Meme: -5,
    },
    includeMemes: false,
  },

  // Full send: everything, including memes
  degen: {
    allowedCategories: ["Top 3", "LST", "DeFi", "DePin", "Stocks", "Meme"],
    categoryWeights: {
      "Top 3": 2,
      LST: 2,
      DeFi: 3,
      DePin: 3,
      Stocks: 0.5, // still allowed, but background noise
      Meme: 3,
    },
    includeMemes: true,
  },
};

/* ─────────────────────────────────────────────
 * Category caps per segment (final list shaping)
 * ─────────────────────────────────────────── */

const SEGMENT_CATEGORY_CAPS: Record<Segment, SegmentCategoryCaps> = {
  conservative: {
    Stocks: 0.8,
    "Top 3": 0.6,
  },
  balanced: {
    Stocks: 0.6,
    "Top 3": 0.6,
    LST: 0.6,
  },
  growth: {
    DeFi: 0.6,
    DePin: 0.6,
    "Top 3": 0.6,
    LST: 0.6,
    Stocks: 0.4,
  },
  degen: {
    // degen: force a mix; no single bucket takes over
    Stocks: 0.3,
    Meme: 0.6,
    DeFi: 0.7,
    DePin: 0.7,
    LST: 0.7,
    "Top 3": 0.7,
  },
};

/**
 * Order in which we try to *fill* categories for each segment.
 * This is the “vibe dial”.
 */
const SEGMENT_PRIORITY_ORDER: Record<Segment, SegmentPriorityOrder> = {
  conservative: ["Stocks", "Top 3"],
  balanced: ["Stocks", "Top 3", "LST"],
  growth: ["DeFi", "DePin", "Top 3", "LST", "Stocks"],
  degen: ["DeFi", "DePin", "Meme", "LST", "Top 3", "Stocks"],
};

/* ─────────────────────────────────────────────
 * Segment helpers
 * ─────────────────────────────────────────── */

function normalizeRisk(r: AppUser["riskLevel"]): RiskLevel {
  if (r === "medium" || r === "high") return r;
  return "low";
}

function normalizeKnowledge(
  k: AppUser["financialKnowledgeLevel"]
): KnowledgeLevel {
  if (k === "beginner" || k === "intermediate" || k === "advanced") return k;
  return "none";
}

function pickSegment(risk: RiskLevel, knowledge: KnowledgeLevel): Segment {
  if (risk === "low" && (knowledge === "none" || knowledge === "beginner")) {
    return "conservative";
  }

  if (risk === "low") {
    return "balanced";
  }

  if (risk === "medium") {
    if (knowledge === "none" || knowledge === "beginner") return "balanced";
    return "growth";
  }

  // risk === "high"
  if (knowledge === "intermediate" || knowledge === "advanced") {
    return "degen";
  }

  return "growth";
}

/* ─────────────────────────────────────────────
 * Selection with category caps
 * ─────────────────────────────────────────── */

function selectWithCategoryCaps(
  candidates: TokenRecommendation[],
  segment: Segment,
  limit: number
): TokenRecommendation[] {
  if (!candidates.length || limit <= 0) return [];

  const caps = SEGMENT_CATEGORY_CAPS[segment] || {};
  const priorities = SEGMENT_PRIORITY_ORDER[segment] || [];

  const counts: Partial<Record<TokenCategory, number>> = {};
  const result: TokenRecommendation[] = [];

  const maxForCat = (cat: TokenCategory): number => {
    const cap = caps[cat];
    if (!cap || cap <= 0) return limit; // effectively uncapped
    return Math.max(1, Math.floor(limit * cap));
  };

  const isAtCap = (cat: TokenCategory): boolean => {
    const used = counts[cat] ?? 0;
    return used >= maxForCat(cat);
  };

  const byCategory: Partial<Record<TokenCategory, TokenRecommendation[]>> = {};
  for (const rec of candidates) {
    const cat = rec.token.category as TokenCategory | undefined;
    if (!cat) continue;
    if (!byCategory[cat]) byCategory[cat] = [];
    byCategory[cat]!.push(rec);
  }

  // Sort each category bucket by score desc, then symbol asc
  for (const cat of Object.keys(byCategory) as TokenCategory[]) {
    byCategory[cat]!.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.token.symbol.localeCompare(b.token.symbol);
    });
  }

  const takeFromCategory = (cat: TokenCategory) => {
    const bucket = byCategory[cat];
    if (!bucket || !bucket.length) return;

    while (bucket.length && result.length < limit && !isAtCap(cat)) {
      const rec = bucket.shift()!;
      result.push(rec);
      counts[cat] = (counts[cat] ?? 0) + 1;
    }
  };

  // Pass 1: walk through priority categories in order
  for (const cat of priorities) {
    if (result.length >= limit) break;
    takeFromCategory(cat);
  }

  // Pass 2: fill remaining slots with whatever highest-score stuff is left
  if (result.length < limit) {
    const remaining: TokenRecommendation[] = [];
    for (const cat of Object.keys(byCategory) as TokenCategory[]) {
      remaining.push(...(byCategory[cat] || []));
    }
    remaining.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.token.symbol.localeCompare(b.token.symbol);
    });

    for (const rec of remaining) {
      if (result.length >= limit) break;
      const cat = rec.token.category as TokenCategory | undefined;
      if (!cat) continue;
      if (isAtCap(cat)) continue;
      result.push(rec);
      counts[cat] = (counts[cat] ?? 0) + 1;
    }
  }

  return result;
}

/* ─────────────────────────────────────────────
 * Main engine
 * ─────────────────────────────────────────── */

type BuildOpts = {
  limit?: number;
  /** Token mints already wishlisted – don't recommend them */
  wishlistMints?: string[];
};

/**
 * Main entry: given a user + their wallet tokens, return a list
 * of token recommendations they *don't own yet* and *aren't already
 * on their wishlist*.
 */
export function buildTokenRecommendations(
  user: AppUser,
  walletTokens: WalletToken[],
  opts?: BuildOpts
): TokenRecommendation[] {
  const risk = normalizeRisk(user.riskLevel || "low");
  const knowledge = normalizeKnowledge(user.financialKnowledgeLevel || "none");
  const segment = pickSegment(risk, knowledge);
  const config = SEGMENT_CONFIG[segment];

  const cluster = getCluster();

  // Tokens user already owns (never recommend those)
  const ownedMints = new Set(walletTokens.map((t) => t.mint));

  // Tokens user already wishlisted (also never recommend those)
  const wishlistSet = new Set((opts?.wishlistMints ?? []).map((m) => m.trim()));

  // Rough category exposure in USD
  const categoryExposure: Partial<Record<TokenCategory, number>> = {};
  for (const wt of walletTokens) {
    const meta = findTokenByMint(wt.mint, cluster);
    if (!meta || !meta.category) continue;
    const cat = meta.category;
    const usd = wt.usdValue ?? 0;
    categoryExposure[cat] = (categoryExposure[cat] ?? 0) + usd;
  }

  const totalExposure = Object.values(categoryExposure).reduce(
    (sum, v) => sum + (v ?? 0),
    0
  );

  const candidates: TokenRecommendation[] = [];

  for (const token of TOKENS) {
    const mint = getMintFor(token, cluster);
    if (!mint) continue; // not on this cluster

    // 🚫 never surface stuff they own or already wishlisted
    if (ownedMints.has(mint)) continue;
    if (wishlistSet.has(mint)) continue;

    const cat = token.category as TokenCategory | undefined;
    if (!cat) continue;

    // Respect segment allowed categories + meme rules
    if (!config.allowedCategories.includes(cat)) continue;
    if (!config.includeMemes && cat === "Meme") continue;

    let score = 0;
    const reasons: string[] = [];

    // Category base preference for this segment
    const catWeight = config.categoryWeights[cat] ?? 0;
    score += catWeight;

    // Exposure-based nudge: this just sorts *within* category mostly
    const exp = categoryExposure[cat] ?? 0;
    const expShare = totalExposure > 0 ? exp / totalExposure : 0;

    if (totalExposure === 0) {
      score += 0.5;
      reasons.push(
        `You don't have any ${categoryLabels[cat]} in your Haven wallet yet.`
      );
    } else if (expShare === 0) {
      score += 1.0;
      reasons.push(
        `You don't have any ${categoryLabels[cat]} exposure yet — this helps you explore it.`
      );
    } else if (expShare < 0.1) {
      score += 0.4;
      reasons.push(
        `Your ${categoryLabels[cat]} exposure is still small — adding here keeps things balanced.`
      );
    } else if (expShare > 0.5) {
      score -= 0.5;
      reasons.push(
        `You're already heavily tilted to ${categoryLabels[cat]} — we slightly down-weight more of it.`
      );
    }

    // Segment-level context (top reason)
    if (segment === "conservative") {
      reasons.unshift(
        "You set low risk / low experience, so we lean into simpler, lower-volatility categories."
      );
    } else if (segment === "balanced") {
      reasons.unshift(
        "You chose a balanced profile, so we mix core assets with some yield and growth."
      );
    } else if (segment === "growth") {
      reasons.unshift(
        "You’re comfortable with more risk, so we bias towards DeFi, DePin, and staked SOL yield."
      );
    } else if (segment === "degen") {
      reasons.unshift(
        "High risk + strong experience — we prioritise DeFi, DePin, and memecoins, with some LSTs and majors for balance."
      );
    }

    if (score <= 0) continue;

    candidates.push({ token, score, reasons });
  }

  if (!candidates.length) return [];

  // 🔢 Dynamic limit: 5–15 unless you explicitly clamp it
  const available = candidates.length;
  const requested = opts?.limit;

  let limit: number;
  if (requested && requested > 0) {
    limit = Math.min(requested, available);
  } else {
    const MIN = 5;
    const MAX = 15;
    limit = Math.min(MAX, Math.max(MIN, available));
  }

  return selectWithCategoryCaps(candidates, segment, limit);
}
