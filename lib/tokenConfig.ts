// lib/tokenConfig.ts

/* -------------------------------- Types -------------------------------- */

export type Cluster = "mainnet" | "devnet";
export type TokenCategory = "Top 3" | "DeFi" | "Meme" | "Stocks" | "LST" | "DePin";

/** TradingView mapping for embedding charts */
export type TradingViewMap = {
  /** Full TradingView 'proName' like 'BINANCE:BTCUSDT' or 'NASDAQ:AAPL' */
  proName: string;
  /** Display-friendly pair, e.g. 'BTC/USDT' or 'AAPL' */
  short?: string;
  /** Exchange identifier TradingView uses (BINANCE, COINBASE, NASDAQ, AMEX, etc.) */
  exchange: string;
  /** Base/quote for clarity when crypto */
  base?: string;
  quote?: string;
  /** Optional default interval for your widget ('1', '5', '15', '60', '240', 'D', etc.) */
  defaultInterval?: string;
};

export type TokenMeta = {
  name: string;
  symbol: string;
  /** Optional internal id/slug if you ever need it */
  id?: string;
  /** path under /public, e.g. /logos/sol.png */
  logo: string;
  category?: TokenCategory;
  decimals?: number;
  mints: Partial<Record<Cluster, string>>;
  tv: TradingViewMap;
  
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

export const TOKENS: TokenMeta[] = [
  {
    name: "Solana",
    symbol: "SOL",
    id: "solana",
    logo: "/logos/sol.png",
    category: "Top 3",
    decimals: 9,
    mints: {
      mainnet: WSOL_MINT,
      devnet: WSOL_MINT,
    },
    tv: {
      proName: "BINANCE:SOLUSDT",
      short: "SOL/USDT",
      exchange: "BINANCE",
      base: "SOL",
      quote: "USDT",
      defaultInterval: "60", // 1h
    },
  },
  {
    name: "Bitcoin",
    symbol: "BTC",
    id: "bitcoin",
    logo: "/logos/btc.png",
    category: "Top 3",
    decimals: 8,
    mints: {
      mainnet: "3NZ9JMVBmGAqocybic2c7LQCJScmgsAZ6vQqTDzcqmJh",
    },
    tv: {
      proName: "BINANCE:BTCUSDT",
      short: "BTC/USDT",
      exchange: "BINANCE",
      base: "BTC",
      quote: "USDT",
      defaultInterval: "60", // 1h
    },
  },
  {
    name: "Ethereum",
    symbol: "ETH",
    id: "ethereum",
    logo: "/logos/eth.png",
    category: "Top 3",
    decimals: 8,
    mints: {
      mainnet: "7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs",
    },
    tv: {
      proName: "BINANCE:ETHUSDT",
      short: "ETH/USDT",
      exchange: "BINANCE",
      base: "ETH",
      quote: "USDT",
      defaultInterval: "60",
    },
  },
  {
    name: "S&P500",
    symbol: "SPY",
    id: "sp500-xstock",
    logo: "/logos/spx.webp",
    category: "Stocks",
    decimals: 8,
    mints: {
      mainnet: "XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W",
    },
    tv: {
      proName: "AMEX:SPY",
      short: "SPY",
      exchange: "AMEX",
      defaultInterval: "60",
    },
  },
  {
    name: "Tesla",
    symbol: "TSLA",
    id: "tesla-xstock",
    logo: "/logos/tsla.webp",
    category: "Stocks",
    decimals: 8,
    mints: {
      mainnet: "XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB",
    },
    tv: {
      proName: "NASDAQ:TSLA",
      short: "TSLA",
      exchange: "NASDAQ",
      defaultInterval: "60",
    },
  },
  {
    name: "Nvidia",
    symbol: "NVDA",
    id: "nvidia-xstock",
    logo: "/logos/nvda.webp",
    category: "Stocks",
    decimals: 8,
    mints: {
      mainnet: "Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh",
    },
    tv: {
      proName: "NASDAQ:NVDA",
      short: "NVDA",
      exchange: "NASDAQ",
      defaultInterval: "60",
    },
  },
  {
    name: "NasDaq",
    symbol: "QQQ",
    id: "nasdaq-xstock",
    logo: "/logos/qqq.png",
    category: "Stocks",
    decimals: 8,
    mints: {
      mainnet: "Xs8S1uUs1zvS2p7iwtsG3b6fkhpvmwz4GYU3gWAmWHZ",
    },
    tv: {
      proName: "NASDAQ:QQQ",
      short: "QQQ",
      exchange: "NASDAQ",
      defaultInterval: "60",
    },
  },
  {
    name: "Apple",
    symbol: "AAPL",
    id: "apple-xstock",
    logo: "/logos/aapl.webp",
    category: "Stocks",
    decimals: 8,
    mints: {
      mainnet: "XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp",
    },
    tv: {
      proName: "NASDAQ:AAPL",
      short: "AAPL",
      exchange: "NASDAQ",
      defaultInterval: "60",
    },
  },
  {
    name: "Alphabet",
    symbol: "GOOGL",
    id: "alphabet-xstock",
    logo: "/logos/google.webp",
    category: "Stocks",
    decimals: 8,
    mints: {
      mainnet: "XsCPL9dNWBMvFtTmwcCA5v3xWPSMEBCszbQdiLLq6aN",
    },
    tv: {
      proName: "NASDAQ:GOOGL",
      short: "GOOGL",
      exchange: "NASDAQ",
      defaultInterval: "60",
    },
  },
  {
    name: "Raydium",
    symbol: "RAY",
    id: "raydium",
    logo: "/logos/ray.jpg",
    category: "DeFi",
    decimals: 8,
    mints: {
      mainnet: "4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R",
    },
    tv: {
      proName: "BINANCE:RAYUSDT",
      short: "RAY/USDT",
      exchange: "BINANCE",
      base: "RAY",
      quote: "USDT",
      defaultInterval: "60",
    },
  },
  {
    name: "Jupiter",
    symbol: "JUP",
    id: "jupiter-exchange-solana",
    logo: "/logos/jup.webp",
    category: "DeFi",
    decimals: 8,
    mints: {
      mainnet: "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN",
    },
    tv: {
      proName: "BINANCE:JUPUSDT",
      short: "JUP/USDT",
      exchange: "BINANCE",
      base: "JUP",
      quote: "USDT",
      defaultInterval: "60",
    },
  },
  {
    name: "Kamino",
    symbol: "kamino",
    id: "kmno",
    logo: "/logos/kmno.jpg",
    category: "DeFi",
    decimals: 8,
    mints: {
      mainnet: "KMNo3nJsBXfcpJTVhZcXLW7RmTwTt4GVFE7suUBo9sS",
    },
    tv: {
      proName: "BYBIT:KMNOUSDT",
      short: "KMNO/USDT",
      exchange: "BYBIT",
      base: "KMNO",
      quote: "USDT",
      defaultInterval: "60",
    },
  },
  {
    name: "Bonk",
    symbol: "BONK",
    id: "bonk",
    logo: "/logos/bonk.jpg",
    category: "Meme",
    decimals: 8,
    mints: {
      mainnet: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263",
    },
    tv: {
      proName: "BINANCE:BONKUSDT",
      short: "BONK/USDT",
      exchange: "BINANCE",
      base: "BONK",
      quote: "USDT",
      defaultInterval: "60",
    },
  },
  {
    name: "Pump.fun",
    symbol: "PUMP",
    id: "pump-fun",
    logo: "/logos/pump.jpg",
    category: "Meme",
    decimals: 8,
    mints: {
      mainnet: "pumpCmXqMfrsAkQ5r49WcJnRayYRqmXz6ae8H7H9Dfn",
    },
    tv: {
      proName: "GATEIO:PUMPUSDT",
      short: "PUMP/USDT",
      exchange: "GATEIO",
      base: "PUMP",
      quote: "USDT",
      defaultInterval: "60",
    },
  },
  {
    name: "DogWifHat",
    symbol: "WIF",
    id: "dogwifcoin",
    logo: "/logos/wif.jpg",
    category: "Meme",
    decimals: 8,
    mints: {
      mainnet: "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm",
    },
    tv: {
      proName: "BINANCE:WIFUSDT",
      short: "WIF/USDT",
      exchange: "BINANCE",
      base: "WIF",
      quote: "USDT",
      defaultInterval: "60",
    },
  },
  {
    name: "Meta",
    symbol: "META",
    id: "meta-xstock",
    logo: "/logos/meta.webp",
    category: "Stocks",
    decimals: 8,
    mints: {
      mainnet: "Xsa62P5mvPszXL1krVUnU5ar38bBSVcWAB6fmPCo5Zu",
    },
    tv: {
      proName: "NASDAQ:META",
      short: "META",
      exchange: "NASDAQ",
      defaultInterval: "60",
    },
  },
  {
    name: "Gold",
    symbol: "GLDX",
    id: "gold-xstock",
    logo: "/logos/gld.png",
    category: "Stocks",
    decimals: 8,
    mints: {
      mainnet: "Xsv9hRk1z5ystj9MhnA7Lq4vjSsLwzL2nxrwmwtD3re",
    },
    tv: {
      proName: "NASDAQ:GLD",
      short: "GLD",
      exchange: "NASDAQ",
      defaultInterval: "60",
    },
  },

  {
    name: "Coinbase",
    symbol: "COIN",
    id: "coinbase-xstock",
    logo: "/logos/coin.webp",
    category: "Stocks",
    decimals: 8,
    mints: {
      mainnet: "Xs7ZdzSHLU9ftNJsii5fCeJhoRWSC32SQGzGQtePxNu",
    },
    tv: {
      proName: "NASDAQ:COIN",
      short: "COIN",
      exchange: "NASDAQ",
      defaultInterval: "60",
    },
  },
  {
    name: "Robinhood",
    symbol: "HOOD",
    id: "robinhood-xstock",
    logo: "/logos/hood.webp",
    category: "Stocks",
    decimals: 8,
    mints: {
      mainnet: "XsvNBAYkrDRNhA7wPHQfX3ZUXZyZLdnCQDfHZ56bzpg",
    },
    tv: {
      proName: "NASDAQ:HOOD",
      short: "HOOD",
      exchange: "NASDAQ",
      defaultInterval: "60",
    },
  },
  {
    name: "Amazon",
    symbol: "AMZN",
    id: "amazon-xstock",
    logo: "/logos/amzn.webp",
    category: "Stocks",
    decimals: 8,
    mints: {
      mainnet: "Xs3eBt7uRfJX8QUs4suhyU8p2M6DoUDrJyWBa8LLZsg",
    },
    tv: {
      proName: "NASDAQ:AMZN",
      short: "AMZN",
      exchange: "NASDAQ",
      defaultInterval: "60",
    },
  },
  {
    name: "Drift Staked SOL",
    symbol: "DSOL",
    id: "drift-staked-sol",
    logo: "/logos/dsol.png",
    category: "LST",
    decimals: 9,
    mints: {
      mainnet: "Dso1bDeDjCQxTrWHqUUi63oBvV7Mdm6WaobLbQ7gnPQ",
    },
    tv: {
      proName: "PYTH:DSOLUSD",
      short: "dSOL/USD",
      exchange: "PYTH",
      base: "dSOL",
      quote: "USD",
      defaultInterval: "60", // 1h
    },
  },
  {
    name: "Marinade Staked SOL",
    symbol: "MSOL",
    id: "msol",
    logo: "/logos/msol.webp",
    category: "LST",
    decimals: 9,
    mints: {
      mainnet: "mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So",
      // devnet: "<add-devnet-mint-if-you-use-it>",
    },
    tv: {
      proName: "PYTH:MSOLUSDT",
      short: "MSOL/USD",
      exchange: "PYTH",
      base: "MSOL",
      quote: "USD",
      defaultInterval: "60",
    },
  },
  {
    name: "Jito Staked SOL",
    symbol: "JITOSOL",
    id: "jito-staked-sol",
    logo: "/logos/jitosol.png",
    category: "LST",
    decimals: 9,
    mints: {
      mainnet: "J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn",
    },
    tv: {
      proName: "PYTH:SOLUSDT",
      short: "SOL/USDT",
      exchange: "BINANCE",
      base: "SOL",
      quote: "USDT",
      defaultInterval: "60",
    },
  },
  {
    name: "Jupiter Staked SOL",
    symbol: "JUPSOL",
    id: "jupiter-staked-sol",
    logo: "/logos/jupsol.png",
    category: "LST",
    decimals: 9,
    mints: {
      mainnet: "jupSoLaHXQiZZTSfEWMTRRgpnyFm8f6sZdosWBjx93v",
    },
    tv: {
      proName: "PYTH:JUPSOLUSD",
      short: "JUPSOL/USD",
      exchange: "PYTH",
      base: "JUPSOL",
      quote: "USD",
      defaultInterval: "60",
    },
  },
  {
    name: "Helius Staked SOL",
    symbol: "HSOL",
    id: "helius-staked-sol",
    logo: "/logos/hsol.png",
    category: "LST",
    decimals: 9,
    mints: {
      mainnet: "he1iusmfkpAdwvxLNGV8Y1iSbj4rUy6yMhEA3fotn9A",
    },
    tv: {
      proName: "PYTH:HSOLUSD",
      short: "HSOL/USD",
      exchange: "PYTH",
      base: "HSOL",
      quote: "USD",
      defaultInterval: "60",
    },
  },
  {
    name: "Render",
    symbol: "RENDER",
    id: "render-token",
    logo: "/logos/rndr.png",
    category: "DePin",
    decimals: 9,
    mints: {
      mainnet: "rndrizKT3MK1iimdxRdWabcF7Zg7AR5T4nud4EkHBof",
    },
    tv: {
      proName: "PYTH:RENDERUSD",
      short: "RENDER/USD",
      exchange: "PYTH",
      base: "RENDER",
      quote: "USD",
      defaultInterval: "60",
    },
  },
  {
    name: "DoubleZero",
    symbol: "2Z",
    id: "doublezero",
    logo: "/logos/2z.png",
    category: "DePin",
    decimals: 9,
    mints: {
      mainnet: "J6pQQ3FAcJQeWPPGppWRb4nM8jU3wLyYbRrLh7feMfvd",
    },
    tv: {
      proName: "BYBIT:2ZUSDC",
      short: "2Z/USDC",
      exchange: "BYBIT",
      base: "2Z",
      quote: "USDC",
      defaultInterval: "60",
    },
  },
  {
    name: "Helium",
    symbol: "HNT",
    id: "helium",
    logo: "/logos/HNT.png",
    category: "DePin",
    decimals: 9,
    mints: {
      mainnet: "hntyVP6YFm1Hg25TN9WGLqM12b8TQmcknKrdu1oxWux",
    },
    tv: {
      proName: "BYBIT:HNTUSDT",
      short: "HNT/USDT",
      exchange: "BYBIT",
      base: "HNT",
      quote: "USDT",
      defaultInterval: "60",
    },
  },
  {
    name: "Grass",
    symbol: "GRASS",
    id: "grass",
    logo: "/logos/grass.png",
    category: "DePin",
    decimals: 9,
    mints: {
      mainnet: "Grass7B4RdKfBCjTKgSqnXkqjwiGvQyFbuSCUJr3XXjs",
    },
    tv: {
      proName: "BYBIT:GRASSUSDT",
      short: "GRASS/USDT",
      exchange: "BYBIT",
      base: "GRASS",
      quote: "USDT",
      defaultInterval: "60",
    },
  },
  {
    name: "Pudy Penguins",
    symbol: "PENGU",
    id: "pudgy-penguins",
    logo: "/logos/pengu.png",
    category: "Meme",
    decimals: 9,
    mints: {
      mainnet: "2zMMhcVQEXDtdE6vsFS7S7D5oUodfJHE8vd1gnBouauv",
    },
    tv: {
      proName: "BYBIT:PENGUUSDT",
      short: "PENGU/USDT",
      exchange: "BYBIT",
      base: "PENGU",
      quote: "USDT",
      defaultInterval: "60",
    },
  },
  {
    name: "Jupiter Liquidity Perps",
    symbol: "JLP",
    id: "jupiter-perpetuals-liquidity-provider-token",
    logo: "/logos/jlp.jpg",
    category: "DeFi",
    decimals: 8,
    mints: {
      mainnet: "27G8MtK7VtTcCHkpASjSDdkWWYfoqT6ggEuKidVJidD4",
    },
    tv: {
      proName: "PYTH:JLPUSDT",
      short: "JLP/USDT",
      exchange: "BYBIT",
      base: "JLP",
      quote: "USDT",
      defaultInterval: "60",
    },
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
