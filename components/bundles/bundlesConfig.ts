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
    const equalWeight = 100 / allocations.length;
    return allocations.map((a) => ({ ...a, weight: equalWeight }));
  }
  return allocations.map((a) => ({
    ...a,
    weight: (a.weight / total) * 100,
  }));
}

export const BUNDLES: BundleDef[] = [
  // ═══════════════════════════════════════════════════════════════════════════
  // LOW RISK - Conservative portfolios for long-term stability
  // ═══════════════════════════════════════════════════════════════════════════

  {
    id: "core-index",
    name: "Core Index",
    subtitle: "Broad market exposure with quality ballast",
    risk: "low",
    kind: "stocks",
    allocations: [
      { symbol: "SPY", weight: 40 },
      { symbol: "QQQ", weight: 25 },
      { symbol: "BRK.B", weight: 20 },
      { symbol: "UNH", weight: 15 },
    ],
  },
  {
    id: "golden-anchor",
    name: "Golden Anchor",
    subtitle: "Gold-heavy hedge against uncertainty",
    risk: "low",
    kind: "mixed",
    allocations: [
      { symbol: "GLDX", weight: 50 },
      { symbol: "SPY", weight: 30 },
      { symbol: "BTC", weight: 20 },
    ],
  },
  {
    id: "big-tech-stable",
    name: "Big Tech Stable",
    subtitle: "Mega caps with fortress balance sheets",
    risk: "low",
    kind: "stocks",
    allocations: [
      { symbol: "AAPL", weight: 25 },
      { symbol: "MSFT", weight: 25 },
      { symbol: "GOOGL", weight: 25 },
      { symbol: "AMZN", weight: 25 },
    ],
  },
  {
    id: "digital-gold",
    name: "Digital commodity",
    subtitle: "BTC-dominant store of value play",
    risk: "low",
    kind: "crypto",
    allocations: [
      { symbol: "BTC", weight: 50 },
      { symbol: "ETH", weight: 20 },
      { symbol: "GLDX", weight: 30 },
    ],
  },
  {
    id: "healthcare-fortress",
    name: "Healthcare Fortress",
    subtitle: "Defensive healthcare + consumer staples",
    risk: "low",
    kind: "stocks",
    allocations: [
      { symbol: "UNH", weight: 35 },
      { symbol: "JNJ", weight: 35 },
      { symbol: "PG", weight: 30 },
    ],
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // MEDIUM RISK - Balanced portfolios with growth potential
  // ═══════════════════════════════════════════════════════════════════════════

  {
    id: "balanced-core",
    name: "Balanced Core",
    subtitle: "Traditional 60/40 with a crypto twist",
    risk: "medium",
    kind: "mixed",
    allocations: [
      { symbol: "SPY", weight: 35 },
      { symbol: "BTC", weight: 25 },
      { symbol: "ETH", weight: 20 },
      { symbol: "GLDX", weight: 20 },
    ],
  },
  {
    id: "blue-chip-crypto",
    name: "Blue Chip Crypto",
    subtitle: "The big 3 - most liquid & established",
    risk: "medium",
    kind: "crypto",
    allocations: [
      { symbol: "BTC", weight: 50 },
      { symbol: "ETH", weight: 35 },
      { symbol: "SOL", weight: 15 },
    ],
  },
  {
    id: "magnificent-seven",
    name: "Magnificent Seven",
    subtitle: "The tech giants driving markets",
    risk: "medium",
    kind: "stocks",
    allocations: [
      { symbol: "AAPL", weight: 18 },
      { symbol: "MSFT", weight: 18 },
      { symbol: "GOOGL", weight: 16 },
      { symbol: "AMZN", weight: 16 },
      { symbol: "META", weight: 16 },
      { symbol: "NVDA", weight: 16 },
    ],
  },
  {
    id: "fintech-future",
    name: "Fintech Future",
    subtitle: "The new financial infrastructure",
    risk: "medium",
    kind: "mixed",
    allocations: [
      { symbol: "COIN", weight: 30 },
      { symbol: "HOOD", weight: 25 },
      { symbol: "VX", weight: 25 },
      { symbol: "SOL", weight: 20 },
    ],
  },
  {
    id: "smart-contract-trio",
    name: "Smart Contract Trio",
    subtitle: "Leading smart contract platforms",
    risk: "medium",
    kind: "crypto",
    allocations: [
      { symbol: "ETH", weight: 50 },
      { symbol: "SOL", weight: 35 },
      { symbol: "NEAR", weight: 15 },
    ],
  },
  {
    id: "energy-tech-blend",
    name: "Energy + Tech",
    subtitle: "Old economy meets new",
    risk: "medium",
    kind: "stocks",
    allocations: [
      { symbol: "XOM", weight: 30 },
      { symbol: "NVDA", weight: 30 },
      { symbol: "TSLA", weight: 25 },
      { symbol: "ORCL", weight: 15 },
    ],
  },
  {
    id: "yield-seeker",
    name: "Yield Seeker",
    subtitle: "Liquid staking for passive income",
    risk: "medium",
    kind: "crypto",
    allocations: [
      { symbol: "JITOSOL", weight: 35 },
      { symbol: "MSOL", weight: 35 },
      { symbol: "JUPSOL", weight: 30 },
    ],
  },
  {
    id: "crypto-tradfi-bridge",
    name: "Crypto-TradFi Bridge",
    subtitle: "Best of both financial worlds",
    risk: "medium",
    kind: "mixed",
    allocations: [
      { symbol: "BTC", weight: 25 },
      { symbol: "ETH", weight: 20 },
      { symbol: "COIN", weight: 20 },
      { symbol: "SPY", weight: 20 },
      { symbol: "GLDX", weight: 15 },
    ],
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // HIGH RISK - Aggressive portfolios for higher returns
  // ═══════════════════════════════════════════════════════════════════════════

  {
    id: "solana-ecosystem",
    name: "Solana Ecosystem",
    subtitle: "Full Solana stack exposure",
    risk: "high",
    kind: "crypto",
    allocations: [
      { symbol: "SOL", weight: 40 },
      { symbol: "JUP", weight: 20 },
      { symbol: "PYTH", weight: 15 },
      { symbol: "JTO", weight: 15 },
      { symbol: "MPLX", weight: 10 },
    ],
  },
  {
    id: "defi-bluechips",
    name: "DeFi Blue Chips",
    subtitle: "Established DeFi protocols",
    risk: "high",
    kind: "crypto",
    allocations: [
      { symbol: "JUP", weight: 25 },
      { symbol: "RAY", weight: 20 },
      { symbol: "ORCA", weight: 20 },
      { symbol: "DRIFT", weight: 20 },
      { symbol: "KMNO", weight: 15 },
    ],
  },
  {
    id: "lst-maximizer",
    name: "LST Maximizer",
    subtitle: "Liquid staking yield stack",
    risk: "high",
    kind: "crypto",
    allocations: [
      { symbol: "JITOSOL", weight: 30 },
      { symbol: "MSOL", weight: 25 },
      { symbol: "JUPSOL", weight: 20 },
      { symbol: "HSOL", weight: 15 },
      { symbol: "DSOL", weight: 10 },
    ],
  },
  {
    id: "depin-revolution",
    name: "DePIN Revolution",
    subtitle: "Decentralized physical infrastructure",
    risk: "high",
    kind: "crypto",
    allocations: [
      { symbol: "RENDER", weight: 35 },
      { symbol: "HNT", weight: 25 },
      { symbol: "GRASS", weight: 20 },
      { symbol: "HONEY", weight: 12 },
      { symbol: "2Z", weight: 8 },
    ],
  },
  {
    id: "oracle-wars",
    name: "Oracle Wars",
    subtitle: "Data feeds powering DeFi",
    risk: "high",
    kind: "crypto",
    allocations: [
      { symbol: "PYTH", weight: 50 },
      { symbol: "SWTCH", weight: 30 },
      { symbol: "JUP", weight: 20 },
    ],
  },
  {
    id: "ai-revolution",
    name: "AI Revolution",
    subtitle: "Public AI infrastructure plays",
    risk: "high",
    kind: "stocks",
    allocations: [
      { symbol: "NVDA", weight: 40 },
      { symbol: "MSFT", weight: 25 },
      { symbol: "GOOGL", weight: 20 },
      { symbol: "ORCL", weight: 15 },
    ],
  },
  {
    id: "premarket-ai",
    name: "PreMarket AI",
    subtitle: "Private AI company exposure",
    risk: "high",
    kind: "stocks",
    allocations: [
      { symbol: "OPENAI", weight: 35 },
      { symbol: "ANTHROPIC", weight: 35 },
      { symbol: "XAI", weight: 30 },
    ],
  },
  {
    id: "premarket-frontier",
    name: "PreMarket Frontier",
    subtitle: "AI + Space moonshots",
    risk: "high",
    kind: "stocks",
    allocations: [
      { symbol: "OPENAI", weight: 30 },
      { symbol: "ANTHROPIC", weight: 25 },
      { symbol: "SPACEX", weight: 25 },
      { symbol: "XAI", weight: 20 },
    ],
  },
  {
    id: "perp-dex-basket",
    name: "Perp DEX Basket",
    subtitle: "Perpetuals trading infrastructure",
    risk: "high",
    kind: "crypto",
    allocations: [
      { symbol: "JLP", weight: 35 },
      { symbol: "DRIFT", weight: 35 },
      { symbol: "JUP", weight: 30 },
    ],
  },
  {
    id: "sol-defi-yield",
    name: "SOL DeFi Yield",
    subtitle: "Yield-generating DeFi positions",
    risk: "high",
    kind: "crypto",
    allocations: [
      { symbol: "JLP", weight: 30 },
      { symbol: "JITOSOL", weight: 25 },
      { symbol: "KMNO", weight: 20 },
      { symbol: "RAY", weight: 15 },
      { symbol: "MET", weight: 10 },
    ],
  },
  {
    id: "ev-disruption",
    name: "EV Disruption",
    subtitle: "Electric vehicle + energy transition",
    risk: "high",
    kind: "stocks",
    allocations: [
      { symbol: "TSLA", weight: 50 },
      { symbol: "NVDA", weight: 30 },
      { symbol: "XOM", weight: 20 },
    ],
  },
  {
    id: "infrastructure-picks",
    name: "Infra Picks",
    subtitle: "Blockchain infrastructure layer",
    risk: "high",
    kind: "crypto",
    allocations: [
      { symbol: "SOL", weight: 30 },
      { symbol: "PYTH", weight: 25 },
      { symbol: "JTO", weight: 20 },
      { symbol: "MPLX", weight: 15 },
      { symbol: "SWTCH", weight: 10 },
    ],
  },
  {
    id: "l1-rotation",
    name: "L1 Rotation",
    subtitle: "Layer 1 blockchain diversity",
    risk: "high",
    kind: "crypto",
    allocations: [
      { symbol: "SOL", weight: 40 },
      { symbol: "ETH", weight: 35 },
      { symbol: "NEAR", weight: 15 },
      { symbol: "MON", weight: 10 },
    ],
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // DEGEN - High volatility, speculative plays
  // ═══════════════════════════════════════════════════════════════════════════

  {
    id: "meme-lords",
    name: "Meme Lords",
    subtitle: "Solana's top meme coins",
    risk: "degen",
    kind: "crypto",
    allocations: [
      { symbol: "BONK", weight: 30 },
      { symbol: "WIF", weight: 30 },
      { symbol: "PENGU", weight: 20 },
      { symbol: "FART", weight: 20 },
    ],
  },
  {
    id: "degen-full-send",
    name: "Full Send",
    subtitle: "Maximum meme exposure",
    risk: "degen",
    kind: "crypto",
    allocations: [
      { symbol: "BONK", weight: 25 },
      { symbol: "WIF", weight: 25 },
      { symbol: "PUMP", weight: 20 },
      { symbol: "PENGU", weight: 15 },
      { symbol: "FART", weight: 15 },
    ],
  },
  {
    id: "privacy-maximalist",
    name: "Privacy Maximalist",
    subtitle: "Anonymous transaction plays",
    risk: "degen",
    kind: "crypto",
    allocations: [
      { symbol: "BTC", weight: 50 },
      { symbol: "ZEC", weight: 35 },
      { symbol: "GHOST", weight: 15 },
    ],
  },
  {
    id: "alt-l1-bet",
    name: "Alt L1 Bet",
    subtitle: "Next-gen L1 challengers",
    risk: "degen",
    kind: "crypto",
    allocations: [
      { symbol: "NEAR", weight: 35 },
      { symbol: "MON", weight: 35 },
      { symbol: "HYPE", weight: 30 },
    ],
  },
  {
    id: "nft-infra-play",
    name: "NFT Infra Play",
    subtitle: "NFT ecosystem infrastructure",
    risk: "degen",
    kind: "crypto",
    allocations: [
      { symbol: "MPLX", weight: 40 },
      { symbol: "PENGU", weight: 35 },
      { symbol: "SOL", weight: 25 },
    ],
  },
  {
    id: "pump-meta",
    name: "Pump Meta",
    subtitle: "Token launch infrastructure + memes",
    risk: "degen",
    kind: "crypto",
    allocations: [
      { symbol: "PUMP", weight: 40 },
      { symbol: "RAY", weight: 30 },
      { symbol: "JUP", weight: 30 },
    ],
  },
  {
    id: "dog-coins",
    name: "Dog Coins",
    subtitle: "Canine-themed meme plays",
    risk: "degen",
    kind: "crypto",
    allocations: [
      { symbol: "BONK", weight: 50 },
      { symbol: "WIF", weight: 50 },
    ],
  },
  {
    id: "small-cap-defi",
    name: "Small Cap DeFi",
    subtitle: "Emerging DeFi protocols",
    risk: "degen",
    kind: "crypto",
    allocations: [
      { symbol: "MET", weight: 25 },
      { symbol: "DBR", weight: 25 },
      { symbol: "DRIFT", weight: 25 },
      { symbol: "KMNO", weight: 25 },
    ],
  },
  {
    id: "gpu-compute-bet",
    name: "GPU Compute Bet",
    subtitle: "Decentralized compute networks",
    risk: "degen",
    kind: "crypto",
    allocations: [
      { symbol: "RENDER", weight: 60 },
      { symbol: "GRASS", weight: 40 },
    ],
  },
  {
    id: "spacex-yolo",
    name: "Elon YOLO",
    subtitle: "All-in on space exploration",
    risk: "degen",
    kind: "stocks",
    allocations: [
      { symbol: "SPACEX", weight: 30 },
      { symbol: "TSLA", weight: 40 },
      { symbol: "XAI", weight: 30 },
    ],
  },
  {
    id: "exchange-tokens",
    name: "Exchange Tokens",
    subtitle: "Crypto exchange exposure",
    risk: "degen",
    kind: "mixed",
    allocations: [
      { symbol: "COIN", weight: 35 },
      { symbol: "HOOD", weight: 30 },
      { symbol: "JUP", weight: 20 },
      { symbol: "HYPE", weight: 15 },
    ],
  },
  {
    id: "mev-maximizer",
    name: "MEV Maximizer",
    subtitle: "MEV extraction infrastructure",
    risk: "degen",
    kind: "crypto",
    allocations: [
      { symbol: "JTO", weight: 40 },
      { symbol: "JITOSOL", weight: 35 },
      { symbol: "JUP", weight: 25 },
    ],
  },
];
