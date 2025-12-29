// lib/tokenConfig.ts

/* -------------------------------- Types -------------------------------- */

export type Cluster = "mainnet" | "devnet";

export type TokenCategory =
  | "Top MC"
  | "Stocks"
  | "DeFi"
  | "Infrastructure"
  | "Meme"
  | "LST"
  | "DePin"
  | "Gaming"
  | "NFT"
  | "Utility";

export type TokenKind = "crypto" | "stock";

export type TokenMeta = {
  name: string;
  symbol: string;
  id?: string; // slug
  logo: string; // /public path
  kind: TokenKind;

  /** Multi-category (core filtering) */
  categories: TokenCategory[];

  /** Optional micro-filters (secondary UI chips) */
  tags?: string[];

  decimals?: number;
  mints: Partial<Record<Cluster, string>>;
};

/* ------------------------------- Env/Utils ----------------------------- */

export function getCluster(): Cluster {
  const raw = (process.env.NEXT_PUBLIC_SOLANA_CLUSTER || "").toLowerCase();
  if (raw.includes("dev")) return "devnet";
  return "mainnet";
}

export const WSOL_MINT = "So11111111111111111111111111111111111111112";

/** UI-config flat fee shown to user when swapping/buying */
export const CRYPTO_FLAT_FEE_USDC_UI: number = (() => {
  const raw = process.env.NEXT_PUBLIC_CRYPTO_FEE_UI ?? "0.20";
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : 0.2;
})();

/* ------------------------------- Catalog ------------------------------- */
/**
 * No stablecoins here.
 * If you still need USDC internally for swaps/fees, keep it in a separate INTERNAL_TOKENS constant.
 */

export const TOKENS: TokenMeta[] = [
  // ---------------- Top MC (Crypto + tokenized assets)
  {
    name: "Solana",
    symbol: "SOL",
    id: "solana",
    logo: "/logos/sol.png",
    kind: "crypto",
    categories: ["Top MC", "Infrastructure"],
    tags: ["L1"],
    decimals: 9,
    mints: { mainnet: WSOL_MINT, devnet: WSOL_MINT },
  },
  {
    name: "Bitcoin",
    symbol: "BTC",
    id: "bitcoin",
    logo: "/logos/btc.png",
    kind: "crypto",
    categories: ["Top MC"],
    tags: ["Store of Value"],
    decimals: 8,
    mints: { mainnet: "3NZ9JMVBmGAqocybic2c7LQCJScmgsAZ6vQqTDzcqmJh" },
  },
  {
    name: "Ethereum",
    symbol: "ETH",
    id: "ethereum",
    logo: "/logos/eth.png",
    kind: "crypto",
    categories: ["Top MC", "Infrastructure"],
    tags: ["L1"],
    decimals: 8,
    mints: { mainnet: "7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs" },
  },

  // ---------------- Stocks (tokenized)
  {
    name: "S&P500",
    symbol: "SPY",
    id: "sp500-xstock",
    logo: "/logos/spx.webp",
    kind: "stock",
    categories: ["Stocks", "Top MC"],
    tags: ["Index"],
    decimals: 8,
    mints: { mainnet: "XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W" },
  },
  {
    name: "Tesla",
    symbol: "TSLA",
    id: "tesla-xstock",
    logo: "/logos/tsla.webp",
    kind: "stock",
    categories: ["Stocks"],
    tags: ["EV"],
    decimals: 8,
    mints: { mainnet: "XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB" },
  },
  {
    name: "Nvidia",
    symbol: "NVDA",
    id: "nvidia-xstock",
    logo: "/logos/nvda.webp",
    kind: "stock",
    categories: ["Stocks", "Top MC"],
    tags: ["AI"],
    decimals: 8,
    mints: { mainnet: "Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh" },
  },
  {
    name: "NasDaq",
    symbol: "QQQ",
    id: "nasdaq-xstock",
    logo: "/logos/qqq.png",
    kind: "stock",
    categories: ["Stocks"],
    tags: ["Index", "Tech"],
    decimals: 8,
    mints: { mainnet: "Xs8S1uUs1zvS2p7iwtsG3b6fkhpvmwz4GYU3gWAmWHZ" },
  },
  {
    name: "Apple",
    symbol: "AAPL",
    id: "apple-xstock",
    logo: "/logos/aapl.webp",
    kind: "stock",
    categories: ["Stocks"],
    tags: ["Big Tech"],
    decimals: 8,
    mints: { mainnet: "XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp" },
  },
  {
    name: "Alphabet",
    symbol: "GOOGL",
    id: "alphabet-xstock",
    logo: "/logos/google.webp",
    kind: "stock",
    categories: ["Stocks"],
    tags: ["Big Tech"],
    decimals: 8,
    mints: { mainnet: "XsCPL9dNWBMvFtTmwcCA5v3xWPSMEBCszbQdiLLq6aN" },
  },
  {
    name: "Meta",
    symbol: "META",
    id: "meta-xstock",
    logo: "/logos/meta.webp",
    kind: "stock",
    categories: ["Stocks"],
    tags: ["Big Tech"],
    decimals: 8,
    mints: { mainnet: "Xsa62P5mvPszXL1krVUnU5ar38bBSVcWAB6fmPCo5Zu" },
  },
  {
    name: "Gold",
    symbol: "GLDX",
    id: "gold-xstock",
    logo: "/logos/gld.png",
    kind: "stock",
    categories: ["Stocks"],
    tags: ["Commodity"],
    decimals: 8,
    mints: { mainnet: "Xsv9hRk1z5ystj9MhnA7Lq4vjSsLwzL2nxrwmwtD3re" },
  },
  {
    name: "Coinbase",
    symbol: "COIN",
    id: "coinbase-xstock",
    logo: "/logos/coin.webp",
    kind: "stock",
    categories: ["Stocks"],
    tags: ["Exchange"],
    decimals: 8,
    mints: { mainnet: "Xs7ZdzSHLU9ftNJsii5fCeJhoRWSC32SQGzGQtePxNu" },
  },
  {
    name: "Robinhood",
    symbol: "HOOD",
    id: "robinhood-xstock",
    logo: "/logos/hood.webp",
    kind: "stock",
    categories: ["Stocks"],
    tags: ["Broker"],
    decimals: 8,
    mints: { mainnet: "XsvNBAYkrDRNhA7wPHQfX3ZUXZyZLdnCQDfHZ56bzpg" },
  },
  {
    name: "Amazon",
    symbol: "AMZN",
    id: "amazon-xstock",
    logo: "/logos/amzn.webp",
    kind: "stock",
    categories: ["Stocks"],
    tags: ["E-Commerce"],
    decimals: 8,
    mints: { mainnet: "Xs3eBt7uRfJX8QUs4suhyU8p2M6DoUDrJyWBa8LLZsg" },
  },

  // ---------------- DeFi / Infra / DePin / Memes / LSTs
  {
    name: "Raydium",
    symbol: "RAY",
    id: "raydium",
    logo: "/logos/ray.jpg",
    kind: "crypto",
    categories: ["DeFi"],
    tags: ["DEX"],
    decimals: 8,
    mints: { mainnet: "4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R" },
  },
  {
    name: "Jupiter",
    symbol: "JUP",
    id: "jupiter-exchange-solana",
    logo: "/logos/jup.webp",
    kind: "crypto",
    categories: ["DeFi", "Infrastructure"],
    tags: ["Aggregator", "DEX"],
    decimals: 8,
    mints: { mainnet: "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN" },
  },
  {
    name: "Kamino",
    symbol: "KMNO",
    id: "kamino",
    logo: "/logos/kmno.jpg",
    kind: "crypto",
    categories: ["DeFi"],
    tags: ["Lending", "Vaults"],
    decimals: 8,
    mints: { mainnet: "KMNo3nJsBXfcpJTVhZcXLW7RmTwTt4GVFE7suUBo9sS" },
  },
  {
    name: "Bonk",
    symbol: "BONK",
    id: "bonk",
    logo: "/logos/bonk.jpg",
    kind: "crypto",
    categories: ["Meme"],
    tags: ["Community"],
    decimals: 8,
    mints: { mainnet: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263" },
  },
  {
    name: "Pump.fun",
    symbol: "PUMP",
    id: "pump-fun",
    logo: "/logos/pump.jpg",
    kind: "crypto",
    categories: ["Meme"],
    tags: ["Launchpad"],
    decimals: 8,
    mints: { mainnet: "pumpCmXqMfrsAkQ5r49WcJnRayYRqmXz6ae8H7H9Dfn" },
  },
  {
    name: "DogWifHat",
    symbol: "WIF",
    id: "dogwifcoin",
    logo: "/logos/wif.jpg",
    kind: "crypto",
    categories: ["Meme"],
    tags: ["Community"],
    decimals: 8,
    mints: { mainnet: "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm" },
  },

  // LSTs
  {
    name: "Drift Staked SOL",
    symbol: "DSOL",
    id: "drift-staked-sol",
    logo: "/logos/dsol.png",
    kind: "crypto",
    categories: ["LST", "DeFi"],
    tags: ["Staking"],
    decimals: 9,
    mints: { mainnet: "Dso1bDeDjCQxTrWHqUUi63oBvV7Mdm6WaobLbQ7gnPQ" },
  },
  {
    name: "Marinade Staked SOL",
    symbol: "MSOL",
    id: "msol",
    logo: "/logos/msol.webp",
    kind: "crypto",
    categories: ["LST", "DeFi"],
    tags: ["Staking"],
    decimals: 9,
    mints: { mainnet: "mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So" },
  },
  {
    name: "Jito Staked SOL",
    symbol: "JITOSOL",
    id: "jito-staked-sol",
    logo: "/logos/Jitosol.png",
    kind: "crypto",
    categories: ["LST", "DeFi"],
    tags: ["Staking", "MEV"],
    decimals: 9,
    mints: { mainnet: "J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn" },
  },
  {
    name: "Jupiter Staked SOL",
    symbol: "JUPSOL",
    id: "jupiter-staked-sol",
    logo: "/logos/jupsol.png",
    kind: "crypto",
    categories: ["LST", "DeFi"],
    tags: ["Staking"],
    decimals: 9,
    mints: { mainnet: "jupSoLaHXQiZZTSfEWMTRRgpnyFm8f6sZdosWBjx93v" },
  },
  {
    name: "Helius Staked SOL",
    symbol: "HSOL",
    id: "helius-staked-sol",
    logo: "/logos/hsol.png",
    kind: "crypto",
    categories: ["LST", "DeFi", "Infrastructure"],
    tags: ["Staking", "RPC"],
    decimals: 9,
    mints: { mainnet: "he1iusmfkpAdwvxLNGV8Y1iSbj4rUy6yMhEA3fotn9A" },
  },

  // DePin
  {
    name: "Render",
    symbol: "RENDER",
    id: "render-token",
    logo: "/logos/rndr.png",
    kind: "crypto",
    categories: ["DePin", "Top MC"],
    tags: ["GPU"],
    decimals: 9,
    mints: { mainnet: "rndrizKT3MK1iimdxRdWabcF7Zg7AR5T4nud4EkHBof" },
  },
  {
    name: "DoubleZero",
    symbol: "2Z",
    id: "doublezero",
    logo: "/logos/2z.png",
    kind: "crypto",
    categories: ["DePin"],
    tags: ["Network"],
    decimals: 9,
    mints: { mainnet: "J6pQQ3FAcJQeWPPGppWRb4nM8jU3wLyYbRrLh7feMfvd" },
  },
  {
    name: "Helium",
    symbol: "HNT",
    id: "helium",
    logo: "/logos/hnt.png",
    kind: "crypto",
    categories: ["DePin"],
    tags: ["Wireless"],
    decimals: 9,
    mints: { mainnet: "hntyVP6YFm1Hg25TN9WGLqM12b8TQmcknKrdu1oxWux" },
  },
  {
    name: "Grass",
    symbol: "GRASS",
    id: "grass",
    logo: "/logos/grass.png",
    kind: "crypto",
    categories: ["DePin"],
    tags: ["Bandwidth"],
    decimals: 9,
    mints: { mainnet: "Grass7B4RdKfBCjTKgSqnXkqjwiGvQyFbuSCUJr3XXjs" },
  },

  // NFT / Meme adjacent
  {
    name: "Pudgy Penguins",
    symbol: "PENGU",
    id: "pudgy-penguins",
    logo: "/logos/pengu.png",
    kind: "crypto",
    categories: ["Meme", "NFT"],
    tags: ["Brand"],
    decimals: 9,
    mints: { mainnet: "2zMMhcVQEXDtdE6vsFS7S7D5oUodfJHE8vd1gnBouauv" },
  },

  // DeFi
  {
    name: "Jupiter Liquidity Perps",
    symbol: "JLP",
    id: "jupiter-perpetuals-liquidity-provider-token",
    logo: "/logos/jlp.jpg",
    kind: "crypto",
    categories: ["DeFi"],
    tags: ["Perps", "LP"],
    decimals: 8,
    mints: { mainnet: "27G8MtK7VtTcCHkpASjSDdkWWYfoqT6ggEuKidVJidD4" },
  },
  {
    name: "Orca",
    symbol: "ORCA",
    id: "orca",
    logo: "/logos/orca.png",
    kind: "crypto",
    categories: ["DeFi"],
    tags: ["DEX"],
    decimals: 6,
    mints: { mainnet: "orcaEKTdK7LKz57vaAYr9QeNsVEPfiu6QeMU1kektZE" },
  },
  {
    name: "Pyth Network",
    symbol: "PYTH",
    id: "pyth-network",
    logo: "/logos/pyth.png",
    kind: "crypto",
    categories: ["Infrastructure"],
    tags: ["Oracles"],
    decimals: 6,
    mints: { mainnet: "HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3" },
  },
];

/* ------------------------------- Finders -------------------------------- */

export function getMintFor(
  token: Pick<TokenMeta, "mints">,
  cluster: Cluster = getCluster()
): string | null {
  return token.mints[cluster] ?? null;
}

export function tokensForCluster(cluster: Cluster = getCluster()): TokenMeta[] {
  return TOKENS.filter((t) => !!t.mints[cluster]);
}

export function findTokenBySymbol(symbol: string): TokenMeta | undefined {
  const s = symbol.trim().toUpperCase();
  return TOKENS.find((t) => t.symbol.toUpperCase() === s);
}

export function findTokenByMint(
  mint: string,
  cluster: Cluster = getCluster()
): TokenMeta | undefined {
  const m = mint.trim();
  return TOKENS.find((t) => t.mints[cluster] === m);
}

export function requireMintBySymbol(
  symbol: string,
  cluster: Cluster = getCluster()
): string {
  const t = findTokenBySymbol(symbol);
  if (!t) throw new Error(`Unknown token symbol: ${symbol}`);
  const mint = t.mints[cluster];
  if (!mint)
    throw new Error(
      `Token ${symbol} is not enabled on ${cluster}. Add its mint in TOKENS[].mints.${cluster}.`
    );
  return mint;
}

/* --------------------------- Filtering helpers -------------------------- */

export function tokensByCategory(
  category: TokenCategory,
  cluster: Cluster = getCluster()
): TokenMeta[] {
  return TOKENS.filter(
    (t) => !!t.mints[cluster] && t.categories.includes(category)
  );
}

export function tokensByCategories(
  categories: TokenCategory[],
  mode: "any" | "all" = "any",
  cluster: Cluster = getCluster()
): TokenMeta[] {
  const wanted = new Set(categories);
  return TOKENS.filter((t) => {
    if (!t.mints[cluster]) return false;
    const have = new Set(t.categories);
    if (mode === "all") {
      for (const c of wanted) if (!have.has(c)) return false;
      return true;
    }
    // any
    for (const c of wanted) if (have.has(c)) return true;
    return false;
  });
}

export function tokensByTag(
  tag: string,
  cluster: Cluster = getCluster()
): TokenMeta[] {
  const q = tag.trim().toLowerCase();
  return TOKENS.filter(
    (t) =>
      !!t.mints[cluster] && (t.tags ?? []).some((x) => x.toLowerCase() === q)
  );
}
