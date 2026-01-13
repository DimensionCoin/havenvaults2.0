// components/bundles/bundlesConfig.ts

export type RiskLevel = "low" | "medium" | "high" | "degen";

export type TokenAllocation = {
  symbol: string;
  weight: number; // Percentage (0-100), all weights in a bundle must sum to 100
};

export type BundleDef = {
  id: string;
  name: string;
  subtitle: string;
  risk: RiskLevel;
  kind: "stocks" | "crypto" | "mixed";
  allocations: TokenAllocation[];
};

// Helper to get just symbols from a bundle (for backward compatibility)
export function getBundleSymbols(bundle: BundleDef): string[] {
  return bundle.allocations.map((a) => a.symbol);
}

// Helper to normalize weights if they don't sum to 100
export function normalizeWeights(
  allocations: TokenAllocation[]
): TokenAllocation[] {
  const total = allocations.reduce((sum, a) => sum + a.weight, 0);
  if (total === 0) {
    // Equal distribution if all weights are 0
    const equalWeight = 100 / allocations.length;
    return allocations.map((a) => ({ ...a, weight: equalWeight }));
  }
  return allocations.map((a) => ({
    ...a,
    weight: (a.weight / total) * 100,
  }));
}

export const BUNDLES: BundleDef[] = [
  // ───────────────────────────── LOW RISK ─────────────────────────────

  {
    id: "core-index",
    name: "Core Index",
    subtitle: "Set & forget: broad market + quality ballast",
    risk: "low",
    kind: "stocks",
    // Heavy on broad market exposure, quality tilt
    allocations: [
      { symbol: "SPY", weight: 35 }, // Core US market
      { symbol: "QQQ", weight: 25 }, // Tech growth
      { symbol: "BRK.B", weight: 20 }, // Quality conglomerate
      { symbol: "UNH", weight: 10 }, // Healthcare leader
      { symbol: "PG", weight: 10 }, // Consumer staples
    ],
  },
  {
    id: "defensive-cashflow",
    name: "Defensive Cashflow",
    subtitle: "Staples + healthcare + real economy leaders",
    risk: "low",
    kind: "stocks",
    // Balanced defensive positioning
    allocations: [
      { symbol: "WMT", weight: 30 }, // Retail giant, recession-resistant
      { symbol: "JNJ", weight: 30 }, // Healthcare + dividend
      { symbol: "MCD", weight: 20 }, // Consumer defensive
      { symbol: "XOM", weight: 20 }, // Energy + dividend
    ],
  },
  {
    id: "macro-hedge",
    name: "Macro Hedge",
    subtitle: "Gold + quality + a touch of BTC for asymmetric upside",
    risk: "low",
    kind: "mixed",
    // Gold-heavy for hedge, BTC as asymmetric bet
    allocations: [
      { symbol: "GLDX", weight: 35 }, // Primary hedge
      { symbol: "BRK.B", weight: 25 }, // Quality anchor
      { symbol: "BTC", weight: 15 }, // Asymmetric upside
      { symbol: "JNJ", weight: 15 }, // Defensive
      { symbol: "XOM", weight: 10 }, // Real asset exposure
    ],
  },

  // ─────────────────────────── MEDIUM RISK ───────────────────────────

  {
    id: "balanced-core",
    name: "Balanced Core",
    subtitle: "Traditional markets + crypto majors (simple long-term blend)",
    risk: "medium",
    kind: "mixed",
    // Traditional 60/40 inspired with crypto twist
    allocations: [
      { symbol: "SPY", weight: 30 }, // Equity core
      { symbol: "BTC", weight: 25 }, // Digital gold
      { symbol: "ETH", weight: 20 }, // Smart contract leader
      { symbol: "GLDX", weight: 15 }, // Traditional hedge
      { symbol: "SOL", weight: 10 }, // High-performance L1
    ],
  },
  {
    id: "quality-mega-cap",
    name: "Quality Mega Cap",
    subtitle: "Big tech leaders (set & forget growth tilt)",
    risk: "medium",
    kind: "stocks",
    // Market-cap weighted approximation
    allocations: [
      { symbol: "AAPL", weight: 25 }, // Largest by market cap
      { symbol: "MSFT", weight: 25 }, // Enterprise + AI
      { symbol: "GOOGL", weight: 20 }, // Search + AI
      { symbol: "AMZN", weight: 15 }, // E-commerce + cloud
      { symbol: "META", weight: 15 }, // Social + metaverse
    ],
  },
  {
    id: "blue-chip-crypto",
    name: "Blue Chip Crypto",
    subtitle: "The big 3 (most liquid, most established)",
    risk: "medium",
    kind: "crypto",
    // BTC dominant, classic crypto allocation
    allocations: [
      { symbol: "BTC", weight: 50 }, // Store of value, most established
      { symbol: "ETH", weight: 35 }, // Smart contracts leader
      { symbol: "SOL", weight: 15 }, // High-performance alternative
    ],
  },

  // ───────────────────────────── HIGH RISK ─────────────────────────────

  {
    id: "solana-core-stack",
    name: "Solana Core Stack",
    subtitle: "Solana ecosystem leaders (infra + routing + data)",
    risk: "high",
    kind: "crypto",
    // SOL as anchor, ecosystem plays
    allocations: [
      { symbol: "SOL", weight: 40 }, // Ecosystem anchor
      { symbol: "JUP", weight: 20 }, // DEX aggregator leader
      { symbol: "PYTH", weight: 15 }, // Oracle infrastructure
      { symbol: "JTO", weight: 15 }, // MEV/staking
      { symbol: "MPLX", weight: 10 }, // NFT infrastructure
    ],
  },
  {
    id: "solana-defi-traders",
    name: "Solana DeFi Traders",
    subtitle: "Higher beta DeFi (venues + perps + liquidity)",
    risk: "high",
    kind: "crypto",
    // Balanced DeFi exposure
    allocations: [
      { symbol: "JUP", weight: 25 }, // DEX aggregator
      { symbol: "RAY", weight: 20 }, // AMM pioneer
      { symbol: "DRIFT", weight: 20 }, // Perps leader
      { symbol: "ORCA", weight: 20 }, // Concentrated liquidity
      { symbol: "KMNO", weight: 15 }, // Yield optimizer
    ],
  },
  {
    id: "onchain-yield-stack",
    name: "Onchain Yield Stack",
    subtitle: "LST yield + DeFi yield (more stable than pure memes)",
    risk: "high",
    kind: "crypto",
    // LST-heavy for yield generation
    allocations: [
      { symbol: "JITOSOL", weight: 30 }, // MEV-enhanced staking
      { symbol: "MSOL", weight: 25 }, // Marinade staking
      { symbol: "JLP", weight: 20 }, // Jupiter LP yield
      { symbol: "HSOL", weight: 15 }, // Helius staking
      { symbol: "KMNO", weight: 10 }, // Yield protocol
    ],
  },
  {
    id: "depin-rotation",
    name: "DePIN Rotation",
    subtitle: "Real-world networks + infrastructure primitives",
    risk: "high",
    kind: "crypto",
    // Established DePIN weighted higher
    allocations: [
      { symbol: "RENDER", weight: 30 }, // GPU compute leader
      { symbol: "HNT", weight: 25 }, // IoT network pioneer
      { symbol: "GRASS", weight: 20 }, // AI data network
      { symbol: "HONEY", weight: 15 }, // Hive mapper
      { symbol: "2Z", weight: 10 }, // Emerging DePIN
    ],
  },
  {
    id: "premarket-frontier",
    name: "PreMarket Frontier",
    subtitle: "5-year private market bets (AI + space)",
    risk: "high",
    kind: "stocks",
    // AI-heavy allocation
    allocations: [
      { symbol: "OPENAI", weight: 35 }, // AI leader
      { symbol: "ANTHROPIC", weight: 30 }, // AI safety leader
      { symbol: "SPACEX", weight: 20 }, // Space infrastructure
      { symbol: "XAI", weight: 15 }, // Emerging AI
    ],
  },

  // ───────────────────────────── DEGEN ─────────────────────────────

  {
    id: "memes-degen",
    name: "Memes (Degen)",
    subtitle: "High risk, high reward (momentum + culture)",
    risk: "degen",
    kind: "crypto",
    // More established memes weighted higher
    allocations: [
      { symbol: "BONK", weight: 30 }, // OG Solana meme
      { symbol: "WIF", weight: 25 }, // Viral meme
      { symbol: "PENGU", weight: 20 }, // NFT crossover
      { symbol: "PUMP", weight: 15 }, // Meta meme
      { symbol: "FART", weight: 10 }, // Degen play
    ],
  },
  {
    id: "privacy-paranoia",
    name: "Privacy Paranoia",
    subtitle: "Small basket, big narratives (very volatile)",
    risk: "degen",
    kind: "crypto",
    // BTC as anchor even in privacy theme
    allocations: [
      { symbol: "BTC", weight: 50 }, // Store of value anchor
      { symbol: "ZEC", weight: 35 }, // Privacy leader
      { symbol: "GHOST", weight: 15 }, // Pure privacy play
    ],
  },
  {
    id: "alt-infra-bet",
    name: "Alt L1 Infra Bet",
    subtitle: "Higher volatility infra (L1 + builders) beyond the majors",
    risk: "degen",
    kind: "crypto",
    // L1s weighted higher than tools
    allocations: [
      { symbol: "NEAR", weight: 30 }, // Sharded L1
      { symbol: "MON", weight: 25 }, // Gaming L1
      { symbol: "PYTH", weight: 20 }, // Cross-chain oracle
      { symbol: "SWTCH", weight: 15 }, // Infrastructure
      { symbol: "DBR", weight: 10 }, // Builder tools
    ],
  },
];
