// components/bundles/bundlesConfig.ts
import type { TokenKind } from "@/lib/tokenConfig";

export type RiskLevel = "low" | "medium" | "high" | "degen";

export type BundleDef = {
  id: string;
  name: string;
  subtitle: string;
  risk: RiskLevel;
  kind: "stocks" | "crypto" | "mixed";
  symbols: string[]; // MUST exist in tokenConfig
};

export const BUNDLES: BundleDef[] = [
  {
    id: "core-index",
    name: "Core Index",
    subtitle: "Set & forget stocks basket",
    risk: "low",
    kind: "stocks",
    symbols: ["SPY", "QQQ", "AAPL", "MSFT", "NVDA"],
  },
  {
    id: "balanced-core",
    name: "Balanced Core",
    subtitle: "Stocks + crypto majors",
    risk: "medium",
    kind: "mixed",
    symbols: ["SPY", "QQQ", "BTC", "ETH", "SOL"],
  },
  {
    id: "blue-chip-crypto",
    name: "Blue Chip Crypto",
    subtitle: "The big 3",
    risk: "medium",
    kind: "crypto",
    symbols: ["BTC", "ETH", "SOL"],
  },
  {
    id: "sol-builders",
    name: "Solana Builders",
    subtitle: "Core SOL infra exposure",
    risk: "medium",
    kind: "crypto",
    symbols: ["SOL", "JUP", "JTO", "PYTH"],
  },
  {
    id: "staked-sol-basket",
    name: "Staked SOL Basket",
    subtitle: "Liquid staked SOL mix",
    risk: "medium",
    kind: "crypto",
    symbols: ["JITOSOL", "MSOL", "JUPSOL", "HSOL"],
  },
  {
    id: "sol-defi-power",
    name: "Solana DeFi Power",
    subtitle: "Higher beta Solana DeFi",
    risk: "high",
    kind: "crypto",
    symbols: ["JUP", "RAY", "ORCA", "KMNO", "DRIFT"],
  },
  {
    id: "depin-rotation",
    name: "DePIN Rotation",
    subtitle: "Infrastructure + real-world networks",
    risk: "high",
    kind: "crypto",
    symbols: ["RENDER", "HNT", "HONEY", "GRASS", "2Z"],
  },
  {
    id: "memes-degen",
    name: "Memes (Degen)",
    subtitle: "High risk, high reward",
    risk: "degen",
    kind: "crypto",
    symbols: ["BONK", "WIF", "PUMP", "FART", "PENGU"],
  },
  {
    id: "premarket-ai",
    name: "PreMarket AI",
    subtitle: "Private market AI exposure",
    risk: "high",
    kind: "stocks",
    symbols: ["OPENAI", "ANTHROPIC", "XAI", "NVDA", "QQQ"],
  },
];
