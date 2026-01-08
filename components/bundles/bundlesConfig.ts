// components/bundles/bundlesConfig.ts

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
  // ───────────────────────────── LOW RISK ─────────────────────────────

  {
    id: "core-index",
    name: "Core Index",
    subtitle: "Set & forget: broad market + quality ballast",
    risk: "low",
    kind: "stocks",
    // Broad US + quality conglomerate + healthcare (defensive) + staples tilt
    symbols: ["SPY", "QQQ", "BRK.B", "UNH", "PG"],
  },
  {
    id: "defensive-cashflow",
    name: "Defensive Cashflow",
    subtitle: "Staples + healthcare + real economy leaders",
    risk: "low",
    kind: "stocks",
    // No SPY/QQQ here to reduce overlap; defensives + “boring winners”
    symbols: ["WMT", "JNJ", "MCD", "XOM"],
  },
  {
    id: "macro-hedge",
    name: "Macro Hedge",
    subtitle: "Gold + quality + a touch of BTC for asymmetric upside",
    risk: "low",
    kind: "mixed",
    // Hedge style mix without SPY/QQQ overlap
    symbols: ["GLDX", "BRK.B", "BTC", "JNJ", "XOM"],
  },

  // ─────────────────────────── MEDIUM RISK ───────────────────────────

  {
    id: "balanced-core",
    name: "Balanced Core",
    subtitle: "Traditional markets + crypto majors (simple long-term blend)",
    risk: "medium",
    kind: "mixed",
    // A “default” bundle people actually understand
    symbols: ["SPY", "BTC", "ETH", "SOL", "GLDX"],
  },
  {
    id: "quality-mega-cap",
    name: "Quality Mega Cap",
    subtitle: "Big tech leaders (set & forget growth tilt)",
    risk: "medium",
    kind: "stocks",
    symbols: ["AAPL", "MSFT", "GOOGL", "AMZN", "META"],
  },
  {
    id: "blue-chip-crypto",
    name: "Blue Chip Crypto",
    subtitle: "The big 3 (most liquid, most established)",
    risk: "medium",
    kind: "crypto",
    symbols: ["BTC", "ETH", "SOL"],
  },

  // ───────────────────────────── HIGH RISK ─────────────────────────────

  {
    id: "solana-core-stack",
    name: "Solana Core Stack",
    subtitle: "Solana ecosystem leaders (infra + routing + data)",
    risk: "high",
    kind: "crypto",
    // Distinct from DeFi basket by including infra primitives
    symbols: ["SOL", "JUP", "PYTH", "JTO", "MPLX"],
  },
  {
    id: "solana-defi-traders",
    name: "Solana DeFi Traders",
    subtitle: "Higher beta DeFi (venues + perps + liquidity)",
    risk: "high",
    kind: "crypto",
    // Focused “active DeFi” set; avoids SOL itself to reduce overlap
    symbols: ["JUP", "RAY", "ORCA", "DRIFT", "KMNO"],
  },
  {
    id: "onchain-yield-stack",
    name: "Onchain Yield Stack",
    subtitle: "LST yield + DeFi yield (more stable than pure memes)",
    risk: "high",
    kind: "crypto",
    // Consolidates your old “staked SOL basket” + “yield DeFi” into ONE
    symbols: ["JITOSOL", "MSOL", "HSOL", "JLP", "KMNO"],
  },
  {
    id: "depin-rotation",
    name: "DePIN Rotation",
    subtitle: "Real-world networks + infrastructure primitives",
    risk: "high",
    kind: "crypto",
    symbols: ["RENDER", "HNT", "HONEY", "GRASS", "2Z"],
  },
  {
    id: "premarket-frontier",
    name: "PreMarket Frontier",
    subtitle: "5-year private market bets (AI + space) + public AI proxy",
    risk: "high",
    kind: "stocks",
    // Removes QQQ overlap; NVDA is your public “AI proxy”
    symbols: ["OPENAI", "ANTHROPIC", "XAI", "SPACEX"],
  },

  // ───────────────────────────── DEGEN ─────────────────────────────

  {
    id: "memes-degen",
    name: "Memes (Degen)",
    subtitle: "High risk, high reward (momentum + culture)",
    risk: "degen",
    kind: "crypto",
    symbols: ["BONK", "WIF", "PUMP", "FART", "PENGU"],
  },
  {
    id: "privacy-paranoia",
    name: "Privacy Paranoia",
    subtitle: "Small basket, big narratives (very volatile)",
    risk: "degen",
    kind: "crypto",
    symbols: ["ZEC", "GHOST", "BTC"],
  },
  {
    id: "alt-infra-bet",
    name: "Alt L1 Infra Bet",
    subtitle: "Higher volatility infra (L1 + builders) beyond the majors",
    risk: "degen",
    kind: "crypto",
    // Gives NEAR/MON a home; lowers SOL/JUP overlap elsewhere
    symbols: ["NEAR", "MON", "PYTH", "SWTCH", "DBR"],
  },
];
