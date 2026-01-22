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
  | "Privacy"
  | "PreMarket"
  | "Utility"
  | "Commodity";

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

export const CRYPTO_TOKENS: TokenMeta[] = [
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
  {
    name: "Near",
    symbol: "NEAR",
    id: "near",
    logo: "/logos/near.png",
    kind: "crypto",
    categories: ["Infrastructure"],
    tags: ["L1"],
    decimals: 8,
    mints: { mainnet: "3ZLekZYq2qkZiSpnSvabjit34tUkjSwD1JFuW9as9wBG" },
  },
  {
    name: "Monad",
    symbol: "MON",
    id: "monad",
    logo: "/logos/mon.png",
    kind: "crypto",
    categories: ["Infrastructure"],
    tags: ["L1"],
    decimals: 8,
    mints: { mainnet: "CrAr4RRJMBVwRsZtT62pEhfA9H5utymC2mVx8e7FreP2" },
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
    name: "Meteora",
    symbol: "MET",
    id: "meteora",
    logo: "/logos/met.png",
    kind: "crypto",
    categories: ["DeFi"],
    tags: ["DEX"],
    decimals: 8,
    mints: { mainnet: "METvsvVRapdj9cFLzq4Tr43xK4tAjQfwX76z3n6mWQL" },
  },
  {
    name: "Drift Protocol",
    symbol: "DRIFT",
    id: "drift-protocol",
    logo: "/logos/drift.png",
    kind: "crypto",
    categories: ["DeFi"],
    tags: ["DEX"],
    decimals: 8,
    mints: { mainnet: "DriFtupJYLTosbwoN8koMbEYSx54aFAVLddWsbksjwg7" },
  },
  {
    name: "deBridge",
    symbol: "DBR",
    id: "debridge",
    logo: "/logos/dbr.png",
    kind: "crypto",
    categories: ["DeFi"],
    tags: ["DEX"],
    decimals: 8,
    mints: { mainnet: "DBRiDgJAMsM95moTzJs7M9LnkGErpbv9v6CUR1DXnUu5" },
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
  {
    name: "FARTCOIN",
    symbol: "FART",
    id: "fartcoin",
    logo: "/logos/fart.png",
    kind: "crypto",
    categories: ["Meme"],
    tags: ["Community"],
    decimals: 8,
    mints: { mainnet: "9BB6NFEcjBCtnNLFko2FqVQBq8HHM13kCyYcdQbgpump" },
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
    categories: ["DePin"],
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
    name: "Hivemapper",
    symbol: "HONEY",
    id: "hivemapper",
    logo: "/logos/honey.png",
    kind: "crypto",
    categories: ["DePin"],
    tags: ["Mapping"],
    decimals: 9,
    mints: { mainnet: "4vMsoUT2BWatFweudnQM1xedRLfJgJ7hswhcpz4xgBTy" },
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
  {
    name: "ZCash",
    symbol: "ZEC",
    id: "omnibridge-bridged-zcash-solana",
    logo: "/logos/zec.png",
    kind: "crypto",
    categories: ["Privacy"],
    tags: ["Privacy"],
    decimals: 9,
    mints: { mainnet: "A7bdiYdS5GjqGFtxf17ppRHtDKPkkRqbKtR27dxvQXaS" },
  },
  {
    name: "GhostWareOS",
    symbol: "GHOST",
    id: "ghostwareos",
    logo: "/logos/ghost.png",
    kind: "crypto",
    categories: ["Privacy"],
    tags: ["Privacy"],
    decimals: 9,
    mints: { mainnet: "BBKPiLM9KjdJW7oQSKt99RVWcZdhF6sEHRKnwqeBGHST" },
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
  {
    name: "Metaplex",
    symbol: "MPLX",
    id: "metaplex",
    logo: "/logos/mplx.png",
    kind: "crypto",
    categories: ["NFT", "Infrastructure"],
    tags: ["Brand"],
    decimals: 9,
    mints: { mainnet: "METAewgxyPbgwsseH8T16a39CQ5VyVxZi9zXiDPY18m" },
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
  {
    name: "Switchboard",
    symbol: "SWTCH",
    id: "switchboard",
    logo: "/logos/swtch.png",
    kind: "crypto",
    categories: ["DeFi", "Infrastructure"],
    tags: ["Oracles"],
    decimals: 9,
    mints: { mainnet: "SW1TCHLmRGTfW5xZknqQdpdarB8PD95sJYWpNp9TbFx" },
  },
  {
    name: "HYPE",
    symbol: "HYPE",
    id: "wormhole-bridged-hype",
    logo: "/logos/hype.png",
    kind: "crypto",
    categories: ["DeFi", "Infrastructure"],
    tags: ["DEX"],
    decimals: 9,
    mints: { mainnet: "98sMhvDwXj1RQi5c5Mndm3vPe9cBqPrbLaufMXFNMh5g" },
  },
  {
    name: "Jito",
    symbol: "JTO",
    id: "jito-governance-token",
    logo: "/logos/jto.png",
    kind: "crypto",
    categories: ["DeFi", "Infrastructure"],
    tags: ["DEX"],
    decimals: 9,
    mints: { mainnet: "jtojtomepa8beP8AuQc6eXt5FriJwfFMwQx2v2f9mCL" },
  },
];

export const STOCK_TOKENS: TokenMeta[] = [
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
    name: "Exxon Mobil",
    symbol: "XOM",
    id: "exxon-mobil-xstock",
    logo: "/logos/exxon.png",
    kind: "stock",
    categories: ["Stocks"],
    tags: ["Index", "Tech"],
    decimals: 8,
    mints: { mainnet: "XsaHND8sHyfMfsWPj6kSdd5VwvCayZvjYgKmmcNL5qh" },
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
    name: "GOLD(ETF)",
    symbol: "GLDX",
    id: "gold-xstock",
    logo: "/logos/gld.png",
    kind: "stock",
    categories: ["Stocks", "Commodity"],
    tags: ["Stocks"],
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
  {
    name: "Procter & Gamble",
    symbol: "PG",
    id: "procter-gamble-xstock",
    logo: "/logos/pg.png",
    kind: "stock",
    categories: ["Stocks"],
    tags: ["Index"],
    decimals: 8,
    mints: { mainnet: "XsYdjDjNUygZ7yGKfQaB6TxLh2gC6RRjzLtLAGJrhzV" },
  },
  {
    name: "Johnson & Johnson",
    symbol: "JNJ",
    id: "johnson-johnson-xstock",
    logo: "/logos/jnj.png",
    kind: "stock",
    categories: ["Stocks"],
    tags: ["Index"],
    decimals: 8,
    mints: { mainnet: "XsGVi5eo1Dh2zUpic4qACcjuWGjNv8GCt3dm5XcX6Dn" },
  },
  {
    name: "Walmart",
    symbol: "WMT",
    id: "walmart-xstock",
    logo: "/logos/wmt.png",
    kind: "stock",
    categories: ["Stocks"],
    tags: ["Index"],
    decimals: 8,
    mints: { mainnet: "Xs151QeqTCiuKtinzfRATnUESM2xTU6V9Wy8Vy538ci" },
  },
  {
    name: "UnitedHealth",
    symbol: "UNH",
    id: "unitedhealth-xstock",
    logo: "/logos/unh.png",
    kind: "stock",
    categories: ["Stocks"],
    tags: ["Index"],
    decimals: 8,
    mints: { mainnet: "XszvaiXGPwvk2nwb3o9C1CX4K6zH8sez11E6uyup6fe" },
  },
  {
    name: "Berkshire Hathaway",
    symbol: "BRK.B",
    id: "berkshire-hathaway-xstock",
    logo: "/logos/brk.png",
    kind: "stock",
    categories: ["Stocks"],
    tags: ["Index"],
    decimals: 8,
    mints: { mainnet: "Xs6B6zawENwAbWVi7w92rjazLuAr5Az59qgWKcNb45x" },
  },
  {
    name: "Oracle",
    symbol: "ORCL",
    id: "oracle-xstock",
    logo: "/logos/orcl.png",
    kind: "stock",
    categories: ["Stocks"],
    tags: ["Index"],
    decimals: 8,
    mints: { mainnet: "XsjFwUPiLofddX5cWFHW35GCbXcSu1BCUGfxoQAQjeL" },
  },
  {
    name: "McDonald's",
    symbol: "MCD",
    id: "mcdonald-s-xstock",
    logo: "/logos/mcd.png",
    kind: "stock",
    categories: ["Stocks"],
    tags: ["Index"],
    decimals: 8,
    mints: { mainnet: "XsqE9cRRpzxcGKDXj1BJ7Xmg4GRhZoyY1KpmGSxAWT2" },
  },
  {
    name: "Microsoft",
    symbol: "MSFT",
    id: "microsoft-xstock",
    logo: "/logos/mfst.png",
    kind: "stock",
    categories: ["Stocks"],
    tags: ["Index"],
    decimals: 8,
    mints: { mainnet: "XspzcW1PRtgf6Wj92HCiZdjzKCyFekVD8P5Ueh3dRMX" },
  },
  {
    name: "Visa",
    symbol: "VX",
    id: "visa-xstock",
    logo: "/logos/vx.png",
    kind: "stock",
    categories: ["Stocks"],
    tags: ["Index"],
    decimals: 8,
    mints: { mainnet: "XsqgsbXwWogGJsNcVZ3TyVouy2MbTkfCFhCGGGcQZ2p" },
  },
  {
    name: "Coca-Cola",
    symbol: "KO",
    id: "coca-cola-xstock",
    logo: "/logos/ko.png",
    kind: "stock",
    categories: ["Stocks"],
    tags: ["Index"],
    decimals: 8,
    mints: { mainnet: "XsaBXg8dU5cPM6ehmVctMkVqoiRG2ZjMo1cyBJ3AykQ" },
  },

  // ---------------- PreMarket (tokenized)
  {
    name: "SpaceX",
    symbol: "SPACEX",
    id: "spacex-prestocks-2",
    logo: "/logos/spacex.png",
    kind: "stock",
    categories: ["PreMarket", "Stocks"],
    tags: ["Index"],
    decimals: 8,
    mints: { mainnet: "PreANxuXjsy2pvisWWMNB6YaJNzr7681wJJr2rHsfTh" },
  },
  {
    name: "Anthropic",
    symbol: "ANTHROPIC",
    id: "anthropic-prestocks-2",
    logo: "/logos/anthropic.png",
    kind: "stock",
    categories: ["PreMarket", "Stocks"],
    tags: ["Index"],
    decimals: 8,
    mints: { mainnet: "Pren1FvFX6J3E4kXhJuCiAD5aDmGEb7qJRncwA8Lkhw" },
  },
  {
    name: "xAI",
    symbol: "XAI",
    id: "xai-prestocks-2",
    logo: "/logos/xai.png",
    kind: "stock",
    categories: ["PreMarket", "Stocks"],
    tags: ["Index"],
    decimals: 8,
    mints: { mainnet: "PreC1KtJ1sBPPqaeeqL6Qb15GTLCYVvyYEwxhdfTwfx" },
  },
  {
    name: "OpenAI",
    symbol: "OPENAI",
    id: "openai-prestocks-2",
    logo: "/logos/openai.png",
    kind: "stock",
    categories: ["PreMarket", "Stocks"],
    tags: ["Index"],
    decimals: 8,
    mints: { mainnet: "PreweJYECqtQwBtpxHL171nL2K6umo692gTm7Q3rpgF" },
  },
  //--------------------- Commodity
  {
    name: "GOLD(1 T OZ)",
    symbol: "GLD",
    id: "",
    logo: "/logos/gldoz.png",
    kind: "stock",
    categories: ["Commodity"],
    tags: ["Commodity"],
    decimals: 8,
    mints: { mainnet: "GoLDppdjB1vDTPSGxyMJFqdnj134yH6Prg9eqsGDiw6A" },
  },
  {
    name: "SILVER",
    symbol: "SLV",
    id: "",
    logo: "/logos/slv.png",
    kind: "stock",
    categories: ["Commodity"],
    tags: ["Commodity"],
    decimals: 8,
    mints: { mainnet: "7C56WnJ94iEP7YeH2iKiYpvsS5zkcpP9rJBBEBoUGdzj" },
  },
  {
    name: "COPPER",
    symbol: "CPER",
    id: "",
    logo: "/logos/cper.png",
    kind: "stock",
    categories: ["Commodity"],
    tags: ["Commodity"],
    decimals: 8,
    mints: { mainnet: "C3VLBJB2FhEb47s1WEgroyn3BnSYXaezqtBuu5WNmUGw" },
  },
  {
    name: "PLATINUM",
    symbol: "PPLT",
    id: "",
    logo: "/logos/pt.png",
    kind: "stock",
    categories: ["Commodity"],
    tags: ["Commodity"],
    decimals: 8,
    mints: { mainnet: "EtTQ2QRyf33bd6B2uk7nm1nkinrdGKza66EGdjEY4s7o" },
  },
];

// Backwards compatible: existing code can keep importing TOKENS
export const TOKENS: TokenMeta[] = [...STOCK_TOKENS, ...CRYPTO_TOKENS];

/* ------------------------------- Finders -------------------------------- */

export function getMintFor(
  token: Pick<TokenMeta, "mints">,
  cluster: Cluster = getCluster(),
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
  cluster: Cluster = getCluster(),
): TokenMeta | undefined {
  const m = mint.trim();
  return TOKENS.find((t) => t.mints[cluster] === m);
}

export function requireMintBySymbol(
  symbol: string,
  cluster: Cluster = getCluster(),
): string {
  const t = findTokenBySymbol(symbol);
  if (!t) throw new Error(`Unknown token symbol: ${symbol}`);
  const mint = t.mints[cluster];
  if (!mint)
    throw new Error(
      `Token ${symbol} is not enabled on ${cluster}. Add its mint in TOKENS[].mints.${cluster}.`,
    );
  return mint;
}

/* --------------------------- Filtering helpers -------------------------- */

export function tokensByCategory(
  category: TokenCategory,
  cluster: Cluster = getCluster(),
): TokenMeta[] {
  return TOKENS.filter(
    (t) => !!t.mints[cluster] && t.categories.includes(category),
  );
}

export function tokensByCategories(
  categories: TokenCategory[],
  mode: "any" | "all" = "any",
  cluster: Cluster = getCluster(),
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
  cluster: Cluster = getCluster(),
): TokenMeta[] {
  const q = tag.trim().toLowerCase();
  return TOKENS.filter(
    (t) =>
      !!t.mints[cluster] && (t.tags ?? []).some((x) => x.toLowerCase() === q),
  );
}

/* ------------------------- Optional convenience ------------------------- */
// If you want direct list getters without categories logic:
export function stockTokensForCluster(
  cluster: Cluster = getCluster(),
): TokenMeta[] {
  return STOCK_TOKENS.filter((t) => !!t.mints[cluster]);
}

export function cryptoTokensForCluster(
  cluster: Cluster = getCluster(),
): TokenMeta[] {
  return CRYPTO_TOKENS.filter((t) => !!t.mints[cluster]);
}
