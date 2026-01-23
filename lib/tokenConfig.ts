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
  | "Commodity"
  | "Fund"
  | "ETF";

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
    name: "Apple",
    symbol: "AAPLON",
    id: "apple-ondo-tokenized-stock",
    logo: "/logos/aaplon-apple-123mye-8da1d1de.png",
    kind: "stock",
    categories: ["Stocks"],
    tags: ["Token2022", "Verified"],
    decimals: 9,
    mints: {
      mainnet: "123mYEnRLM2LLYsJW3K6oyYh8uP1fngj732iG638ondo",
    },
  },

  {
    name: "Airbnb",
    symbol: "ABNBON",
    id: "airbnb-ondo-tokenized-stock",
    logo: "/logos/abnbon-airbnb-128qny-8ab5fac3.png",
    kind: "stock",
    categories: ["Stocks"],
    tags: ["Verified", "Token2022"],
    decimals: 9,
    mints: {
      mainnet: "128qNYovdGv2YqayErcJgU7gDwbNVX1VuoxbtWz8ondo",
    },
  },
  {
    name: "Abbott",
    symbol: "ABTON",
    id: "abbott-ondo-tokenized-stock",
    logo: "/logos/abton-abbott-129gro-bdcc90df.png",
    kind: "stock",
    categories: ["Stocks"],
    tags: ["Verified", "Token2022"],
    decimals: 9,
    mints: {
      mainnet: "129gRoHKhVg7CvPMrqVsEB4uYZo6zV4yDZX6NBg9ondo",
    },
  },
  {
    name: "Archer Aviation",
    symbol: "ACHRON",
    id: "archer-aviation-ondo-tokenized-stocks",
    logo: "/logos/achron-archer-aviation-kccvqx-b7117118.png",
    kind: "stock",
    categories: ["Stocks"],
    tags: ["Verified", "Token2022"],
    decimals: 9,
    mints: {
      mainnet: "KcCVQxG9LhFYP5o9DWFKTFgFShPPQkDEemVbiFyondo",
    },
  },
  {
    name: "Accenture",
    symbol: "ACNON",
    id: "accenture-ondo-tokenized-stock",
    logo: "/logos/acnon-accenture-12lxmm-1e7dc146.png",
    kind: "stock",
    categories: ["Stocks"],
    tags: ["Verified", "Token2022"],
    decimals: 9,
    mints: {
      mainnet: "12LxMMJYVSf4LoeqjFE47BQQNRciaH9E3nbDfjH4ondo",
    },
  },
  {
    name: "Adobe",
    symbol: "ADBEON",
    id: "adobe-ondo-tokenized-stock",
    logo: "/logos/adbeon-adobe-12rh6j-f0e52920.png",
    kind: "stock",
    categories: ["Stocks"],
    tags: ["Verified", "Token2022"],
    decimals: 9,
    mints: {
      mainnet: "12Rh6JhfW4X5fKP16bbUdb4pcVCKDHFB48x8GG33ondo",
    },
  },
  
  {
    name: "iShares Core US Aggregate Bond ETF",
    symbol: "AGGON",
    id: "ishares-core-us-aggregate-bond-etf-ondo-tokenized-etf",
    logo: "/logos/aggon-ishares-core-us-aggregate-bond-etf-13qtjk-85d9f3bc.png",
    kind: "stock",
    categories: ["ETF"],
    tags: ["Verified", "Token2022"],
    decimals: 9,
    mints: {
      mainnet: "13qTjKx53y6LKGGStiKeieGbnVx3fx1bbwopKFb3ondo",
    },
  },
  
  {
    name: "AMD",
    symbol: "AMDON",
    id: "amd-ondo-tokenized-stock",
    logo: "/logos/amdon-amd-14dian-288fbb20.png",
    kind: "stock",
    categories: ["Stocks"],
    tags: ["Verified", "Token2022"],
    decimals: 9,
    mints: {
      mainnet: "14diAn5z8kjrKwSC8WLqvBqqe5YmihJhjxRxd8Z6ondo",
    },
  },
  
  {
    name: "Amazon",
    symbol: "AMZNON",
    id: "amazon-ondo-tokenized-stock",
    logo: "/logos/amznon-amazon-14tqdo-7ee5360a.png",
    kind: "stock",
    categories: ["Stocks"],
    tags: ["Verified", "Token2022"],
    decimals: 9,
    mints: {
      mainnet: "14Tqdo8V1FhzKsE3W2pFsZCzYPQxxupXRcqw9jv6ondo",
    },
  },
  
  {
    name: "Apollo Global Management",
    symbol: "APOON",
    id: "apollo-global-management-ondo-tokenized-stock",
    logo: "/logos/apoon-apollo-global-management-14vxah-c910ec16.png",
    kind: "stock",
    categories: ["Stocks"],
    tags: ["Verified", "Token2022"],
    decimals: 9,
    mints: {
      mainnet: "14VXAhoa1R74vi1ZuiQyGLJrnDMfoFBPJSCpGVz3ondo",
    },
  },
  {
    name: "AppLovin",
    symbol: "APPON",
    id: "applovin-ondo-tokenized-stock",
    logo: "/logos/appon-applovin-14z8rq-9bfc2431.png",
    kind: "stock",
    categories: ["Stocks"],
    tags: ["Verified", "Token2022"],
    decimals: 9,
    mints: {
      mainnet: "14Z8rQQe2Aza33YgEUmj3g3QGNz8DXLiFPuCnsD1ondo",
    },
  },
  {
    name: "Arm Holdings plc",
    symbol: "ARMON",
    id: "arm-holdings-plc-ondo-tokenized-stock",
    logo: "/logos/armon-arm-holdings-plc-15sscz-75d07f3b.png",
    kind: "stock",
    categories: ["Stocks"],
    tags: ["Verified", "Token2022"],
    decimals: 9,
    mints: {
      mainnet: "15SsCZqCsM9fZGhTmP4rdJTPT9WGZKazDSsgeQ8ondo",
    },
  },
  {
    name: "ASML Holding NV",
    symbol: "ASMLON",
    id: "asml-holding-nv-ondo-tokenized-stock",
    logo: "/logos/asmlon-asml-holding-nv-1elzpr-45dae12e.png",
    kind: "stock",
    categories: ["Stocks"],
    tags: ["Verified", "Token2022"],
    decimals: 9,
    mints: {
      mainnet: "1eLZPRsn8bAKmoxsqDMH9Q2m2k7GMNp6RLSQGm8ondo",
    },
  },
  {
    name: "Broadcom",
    symbol: "AVGOON",
    id: "broadcom-ondo-tokenized-stock",
    logo: "/logos/avgoon-broadcom-1fwztd-1693a1ad.png",
    kind: "stock",
    categories: ["Stocks"],
    tags: ["Verified", "Token2022"],
    decimals: 9,
    mints: {
      mainnet: "1FWZtdWN7y38BSXGzbs8D6Shk88oL9atDNgbVz9ondo",
    },
  },
  {
    name: "American Express",
    symbol: "AXPON",
    id: "american-express-ondo-tokenized-stock",
    logo: "/logos/axpon-american-express-1wxt6n-ca5121f6.png",
    kind: "stock",
    categories: ["Stocks"],
    tags: ["Verified", "Token2022"],
    decimals: 9,
    mints: {
      mainnet: "1WxT6NdK7uqpfXuKpALxL2n3f7Rq61XXeHA8UM4ondo",
    },
  },
  {
    name: "Alibaba",
    symbol: "BABAON",
    id: "alibaba-ondo-tokenized-stock",
    logo: "/logos/babaon-alibaba-1zvb9e-4475c038.png",
    kind: "stock",
    categories: ["Stocks"],
    tags: ["Verified", "Token2022"],
    decimals: 9,
    mints: {
      mainnet: "1zvb9ELBFShBCWKEk5jRTJAaPAwtVt7quEXx1X4ondo",
    },
  },
  {
    name: "Bank of America",
    symbol: "BACON",
    id: "bank-of-america-ondo-tokenized-stocks",
    logo: "/logos/bacon-bank-of-america-wk8gc6-3c464ebe.png",
    kind: "stock",
    categories: ["Stocks"],
    tags: ["Verified", "Token2022"],
    decimals: 9,
    mints: {
      mainnet: "Wk8gC6iTNp8dqd4ghkJ3h1giiUnyhykwHh7tYWjondo",
    },
  },
  {
    name: "Boeing",
    symbol: "BAON",
    id: "boeing-ondo-tokenized-stock",
    logo: "/logos/baon-boeing-1yvz4l-f29ecbd3.png",
    kind: "stock",
    categories: ["Stocks"],
    tags: ["Verified", "Token2022"],
    decimals: 9,
    mints: {
      mainnet: "1YVZ4LGpq8CAhpdpm3mgy7GgPb83gJczCpxLUQ3ondo",
    },
  },
  
  {
    name: "Baidu",
    symbol: "BIDUON",
    id: "baidu-ondo-tokenized-stock",
    logo: "/logos/biduon-baidu-54corf-39fef16c.png",
    kind: "stock",
    categories: ["Stocks"],
    tags: ["Verified", "Token2022"],
    decimals: 9,
    mints: {
      mainnet: "54CoRF2FYMZNJg9tS36xq5BUcLZ7rju1r59jGc2ondo",
    },
  },
  
  {
    name: "Blackrock, Inc.",
    symbol: "BLKON",
    id: "blackrock-inc-ondo-tokenized-stock",
    logo: "/logos/blkon-blackrock-inc-5h1vpm-306eaece.png",
    kind: "stock",
    categories: ["Stocks"],
    tags: ["Verified", "Token2022"],
    decimals: 9,
    mints: {
      mainnet: "5H1VpMzRuoNtRbPTRCz35ETtEUtnkt8hJuQb9v7ondo",
    },
  },
  
  {
    name: "BitMine Immersion Technologies",
    symbol: "BMNRON",
    id: "bitmine-immersion-technologies-ondo-tokenized-stocks",
    logo: "/logos/bmnron-bitmine-immersion-technologies-myxqkd-ae469538.png",
    kind: "stock",
    categories: ["Stocks"],
    tags: ["Verified", "Token2022"],
    decimals: 9,
    mints: {
      mainnet: "MYXqkDYbzr7vjXAz2BapR4AiYRXzoikGirrLoRzondo",
    },
  },
  {
    name: "B2Gold",
    symbol: "BTGON",
    id: "b2gold-ondo-tokenized-stocks",
    logo: "/logos/btgon-b2gold-cbnvxd-21ef3c25.png",
    kind: "stock",
    categories: ["Stocks"],
    tags: ["Verified", "Token2022"],
    decimals: 9,
    mints: {
      mainnet: "cBnVXDyZgaaLZM18wAmqsUKnRUFAEJWbq6VuUoaondo",
    },
  },
  {
    name: "BitGo Holdings",
    symbol: "BTGOON",
    id: "bitgo-holdings-ondo-tokenized-stock",
    logo: "/logos/btgoon-bitgo-holdings-bgjwgu-01e659ac.png",
    kind: "stock",
    categories: ["Stocks"],
    tags: ["Verified", "Token2022"],
    decimals: 9,
    mints: {
      mainnet: "bgJWGuQxyoyFeXwzYZKBmoujVdatGFYPNFnv1a6ondo",
    },
  },
  
  {
    name: "Caterpillar",
    symbol: "CATON",
    id: "caterpillar-ondo-tokenized-stock",
    logo: "/logos/caton-caterpillar-aerxjj-8a3e46b7.webp",
    kind: "stock",
    categories: ["Stocks"],
    tags: ["Verified", "Token2022"],
    decimals: 9,
    mints: {
      mainnet: "AErxJJxGbc9cZzZoZepN62BNfg5RXns8tmEc3Zpondo",
    },
  },
  {
    name: "Constellation Energy",
    symbol: "CEGON",
    id: "constellation-energy-ondo-tokenized-stock",
    logo: "/logos/cegon-constellation-energy-7nwhif-94ad6918.webp",
    kind: "stock",
    categories: ["Stocks"],
    tags: ["Token2022", "Verified"],
    decimals: 9,
    mints: {
      mainnet: "7NWHifsBnn9DimUeNnsHdEXkTZhXmJTiXxcCngBondo",
    },
  },
  
  {
    name: "Chipotle",
    symbol: "CMGON",
    id: "chipotle-ondo-tokenized-stock",
    logo: "/logos/cmgon-chipotle-5owvsv-5348ff4f.png",
    kind: "stock",
    categories: ["Stocks"],
    tags: ["Verified", "Token2022"],
    decimals: 9,
    mints: {
      mainnet: "5owVsVFSHACQuippFYdLp3qWRobp2EGcwxMmsr6ondo",
    },
  },
  
  {
    name: "Coinbase",
    symbol: "COINON",
    id: "coinbase-ondo-tokenized-stock",
    logo: "/logos/coinon-coinbase-5u6kdi-5e99abc2.png",
    kind: "stock",
    categories: ["Stocks"],
    tags: ["Token2022", "Verified"],
    decimals: 9,
    mints: {
      mainnet: "5u6KDiNJXxX4rGMfYT4BApZQC5CuDNrG6MHkwp1ondo",
    },
  },
  
  {
    name: "ConocoPhillips",
    symbol: "COPON",
    id: "conocophillips-ondo-tokenized-stocks",
    logo: "/logos/copon-conocophillips-x68p9q-432530a3.png",
    kind: "stock",
    categories: ["Stocks"],
    tags: ["Verified", "Token2022"],
    decimals: 9,
    mints: {
      mainnet: "X68p9qTpEMkR1TLpXUP2ZJo8PG4Qge2Y2ZLdjA2ondo",
    },
  },
  {
    name: "Global X Copper Miners ETF",
    symbol: "COPXON",
    id: "global-x-copper-miners-etf-ondo-tokenized-etf",
    logo: "/logos/copxon-global-x-copper-miners-etf-x7j77h-6f0e4ac3.png",
    kind: "stock",
    categories: ["ETF"],
    tags: ["Verified", "Token2022"],
    decimals: 9,
    mints: {
      mainnet: "X7j77hTmjZJbepkXXBcsEapM8qNgdfihkFj6CZ5ondo",
    },
  },
  {
    name: "Costco",
    symbol: "COSTON",
    id: "costco-ondo-tokenized-stock",
    logo: "/logos/coston-costco-6btaz1-75b61214.png",
    kind: "stock",
    categories: ["Stocks"],
    tags: ["Verified", "Token2022"],
    decimals: 9,
    mints: {
      mainnet: "6btaz134wjHkR8sqhAYrtSM6tavftfxnRvnyMd8ondo",
    },
  },
  
  {
    name: "Circle Internet Group",
    symbol: "CRCLON",
    id: "circle-internet-group-ondo-tokenized-stock",
    logo: "/logos/crclon-circle-internet-group-6xheye-2bdd4df3.png",
    kind: "stock",
    categories: ["Stocks"],
    tags: ["Verified", "Token2022"],
    decimals: 9,
    mints: {
      mainnet: "6xHEyem9hmkGtVq6XGCiQUGpPsHBaoYuYdFNZa5ondo",
    },
  },
  {
    name: "Salesforce",
    symbol: "CRMON",
    id: "salesforce-ondo-tokenized-stock",
    logo: "/logos/crmon-salesforce-7d7ukb-8569eeb7.png",
    kind: "stock",
    categories: ["Stocks"],
    tags: ["Verified", "Token2022"],
    decimals: 9,
    mints: {
      mainnet: "7D7ukbcnUNYt7Et5vtsDZhAy28MKu9pkHka1Hp9ondo",
    },
  },
  {
    name: "CrowdStrike",
    symbol: "CRWDON",
    id: "crowdstrike-ondo-tokenized-stocks",
    logo: "/logos/crwdon-crowdstrike-cdkfon-e4bcae14.png",
    kind: "stock",
    categories: ["Stocks"],
    tags: ["Verified", "Token2022"],
    decimals: 9,
    mints: {
      mainnet: "cdKfoNjbXgnSuxvoajhtH3uixfZhq1YXhQsS1Rwondo",
    },
  },
  {
    name: "Cisco Systems",
    symbol: "CSCOON",
    id: "cisco-systems-ondo-tokenized-stock",
    logo: "/logos/cscoon-cisco-systems-7dwcze-5d49142e.png",
    kind: "stock",
    categories: ["Stocks"],
    tags: ["Verified", "Token2022"],
    decimals: 9,
    mints: {
      mainnet: "7DWcZE1uVc8m2mf9pV8KNov28ET7HsvHkhrhgr9ondo",
    },
  },
  
  {
    name: "Chevron",
    symbol: "CVXON",
    id: "chevron-ondo-tokenized-stock",
    logo: "/logos/cvxon-chevron-7tgkzi-68af47ad.png",
    kind: "stock",
    categories: ["Stocks"],
    tags: ["Verified", "Token2022"],
    decimals: 9,
    mints: {
      mainnet: "7tgKziACteG26VjV5xKufojKxwTgCFyTwmWUmz5ondo",
    },
  },
  {
    name: "DoorDash",
    symbol: "DASHON",
    id: "doordash-ondo-tokenized-stock",
    logo: "/logos/dashon-doordash-83p1gc-27d5dd1b.png",
    kind: "stock",
    categories: ["Stocks"],
    tags: ["Verified", "Token2022"],
    decimals: 9,
    mints: {
      mainnet: "83P1gCFBZfGRCwJuBt9juxJKEsZwejJoG66eTZ6ondo",
    },
  },
  
  {
    name: "Deere",
    symbol: "DEON",
    id: "deere-ondo-tokenized-stocks",
    logo: "/logos/deon-deere-cqqyaz-34454f62.png",
    kind: "stock",
    categories: ["Stocks"],
    tags: ["Verified", "Token2022"],
    decimals: 9,
    mints: {
      mainnet: "CqQyAZjB9LGFTG95eiadGTkfhd9QA12ProeKsQmondo",
    },
  },
  {
    name: "Disney",
    symbol: "DISON",
    id: "disney-ondo-tokenized-stock",
    logo: "/logos/dison-disney-mjf1xt-4b35d7aa.png",
    kind: "stock",
    categories: ["Stocks"],
    tags: ["Verified", "Token2022"],
    decimals: 9,
    mints: {
      mainnet: "mJf1xT3suXtkXBCfZcE9oUUuyxkvSgqYBWiX7v1ondo",
    },
  },
  
  {
    name: "iShares MSCI Emerging Markets ETF",
    symbol: "EEMON",
    id: "ishares-msci-emerging-markets-etf-ondo-tokenized-etf",
    logo: "/logos/eemon-ishares-msci-emerging-markets-etf-916sdk-8fc12b65.png",
    kind: "stock",
    categories: ["ETF"],
    tags: ["Verified", "Token2022"],
    decimals: 9,
    mints: {
      mainnet: "916SDKz7y5ZcEZC9CtnQ5Djs1Y8Yv3UAPb6bak8ondo",
    },
  },
  {
    name: "iShares MSCI EAFE ETF",
    symbol: "EFAON",
    id: "ishares-msci-eafe-etf-ondo-tokenized-etf",
    logo: "/logos/efaon-ishares-msci-eafe-etf-abvrym-821a1d65.png",
    kind: "stock",
    categories: ["ETF"],
    tags: ["Verified", "Token2022"],
    decimals: 9,
    mints: {
      mainnet: "AbvryMGnaba9oADMZk8Vp2Av6MtczsncGyfWaC4ondo",
    },
  },
  {
    name: "Equinix",
    symbol: "EQIXON",
    id: "equinix-ondo-tokenized-stock",
    logo: "/logos/eqixon-equinix-aheedm-ef524e8c.png",
    kind: "stock",
    categories: ["Stocks"],
    tags: ["Verified", "Token2022"],
    decimals: 9,
    mints: {
      mainnet: "aheEdmuryJU8ymy8LjYheZH5i2BW1UMsfuWQKD2ondo",
    },
  },
  {
    name: "Figma Ord Shs",
    symbol: "FIGON",
    id: "figma-ord-shs-ondo-tokenized-stock",
    logo: "/logos/figon-figma-ord-shs-alddfs-fb404456.png",
    kind: "stock",
    categories: ["Stocks"],
    tags: ["Verified", "Token2022"],
    decimals: 9,
    mints: {
      mainnet: "aLDdFsr3VTUQaHFK6yNvQxztvxQ8nxW4AMuSGC7ondo",
    },
  },
  
  {
    name: "Futu Holdings",
    symbol: "FUTUON",
    id: "futu-holdings-ondo-tokenized-stock",
    logo: "/logos/futuon-futu-holdings-ao5rkf-8f474197.png",
    kind: "stock",
    categories: ["Stocks"],
    tags: ["Token2022", "Verified"],
    decimals: 9,
    mints: {
      mainnet: "Ao5rKFRQ54W3DKSAtqfhBRPNHewwWRLNLao2JL9ondo",
    },
  },
  
  {
    name: "General Electric",
    symbol: "GEON",
    id: "general-electric-ondo-tokenized-stock",
    logo: "/logos/geon-general-electric-atbfdu-eba446c6.png",
    kind: "stock",
    categories: ["Stocks"],
    tags: ["Verified", "Token2022"],
    decimals: 9,
    mints: {
      mainnet: "aTBfDuLRqYHBiG82bHA7DzwjSDTFre2dRtGH3S5ondo",
    },
  },
  {
    name: "SPDR Gold Shares ",
    symbol: "GLDON",
    id: "spdr-gold-shares-ondo-tokenized",
    logo: "/logos/gldon-spdr-gold-shares-hwfiw4-d334fed6.png",
    kind: "stock",
    categories: ["Stocks", "Commodity"],
    tags: ["Verified", "Token2022"],
    decimals: 9,
    mints: {
      mainnet: "hWfiw4mcxT8rnNFkk6fsCQSxoxgZ9yVhB6tyeVcondo",
    },
  },
  {
    name: "GameStop",
    symbol: "GMEON",
    id: "gamestop-ondo-tokenized-stock",
    logo: "/logos/gmeon-gamestop-aznkt8-8368cc00.png",
    kind: "stock",
    categories: ["Stocks"],
    tags: ["Verified", "Token2022"],
    decimals: 9,
    mints: {
      mainnet: "aznKt8v32CwYMEcTcB4bGTv8DXWStCpHrcCtyy7ondo",
    },
  },
  {
    name: "Alphabet Class A",
    symbol: "GOOGLON",
    id: "alphabet-class-a-ondo-tokenized-stock",
    logo: "/logos/googlon-alphabet-class-a-bbahna-5ab5e57d.png",
    kind: "stock",
    categories: ["Stocks"],
    tags: ["Verified", "Token2022"],
    decimals: 9,
    mints: {
      mainnet: "bbahNA5vT9WJeYft8tALrH1LXWffjwqVoUbqYa1ondo",
    },
  },
  
  {
    name: "Goldman Sachs",
    symbol: "GSON",
    id: "goldman-sachs-ondo-tokenized-stock",
    logo: "/logos/gson-goldman-sachs-bchjry-64bb1aa5.png",
    kind: "stock",
    categories: ["Stocks"],
    tags: ["Verified", "Token2022"],
    decimals: 9,
    mints: {
      mainnet: "BchJRy2snmhJZf3rQ9LJ3ePs2BGfYgfvQNo31d2ondo",
    },
  },
  {
    name: "Home Depot",
    symbol: "HDON",
    id: "home-depot-ondo-tokenized-stock",
    logo: "/logos/hdon-home-depot-mtexkv-5c330b46.png",
    kind: "stock",
    categories: ["Stocks"],
    tags: ["Verified", "Token2022"],
    decimals: 9,
    mints: {
      mainnet: "MtEXKVN3Pcggy8MPA3eJr15H6SK3RXheScqj9qtondo",
    },
  },
  {
    name: "Hims & Hers Health",
    symbol: "HIMSON",
    id: "hims-hers-health-ondo-tokenized-stock",
    logo: "/logos/himson-hims-hers-health-bdh3nj-51b7b384.png",
    kind: "stock",
    categories: ["Stocks"],
    tags: ["Verified", "Token2022"],
    decimals: 9,
    mints: {
      mainnet: "bdh3njeo19d2TBLAKTGvCWdSoArfVw8uZBAJHY4ondo",
    },
  },
  {
    name: "Robinhood Markets",
    symbol: "HOODON",
    id: "robinhood-markets-ondo-tokenized-stock",
    logo: "/logos/hoodon-robinhood-markets-bvdxgv-37c4b0ca.png",
    kind: "stock",
    categories: ["Stocks"],
    tags: ["Token2022", "Verified"],
    decimals: 9,
    mints: {
      mainnet: "BVdXGvmgi6A9oAiwWvBvP76fyTqcCNRJMM7zMN6ondo",
    },
  },
  {
    name: "iBoxx $ High Yield Corporate Bond ETF",
    symbol: "HYGON",
    id: "iboxx-high-yield-corporate-bond-etf-ondo-tokenized-etf",
    logo: "/logos/hygon-iboxx-high-yield-corporate-bond-etf-c5ug15-71388d52.png",
    kind: "stock",
    categories: ["ETF"],
    tags: ["Verified", "Token2022"],
    decimals: 9,
    mints: {
      mainnet: "c5ug15fwZRfQhhVa6LHscFY33ebVDHcVCezYpj7ondo",
    },
  },
  {
    name: "iShares Gold Trust",
    symbol: "IAUON",
    id: "ishares-gold-trust-ondo-tokenized-stock",
    logo: "/logos/iauon-ishares-gold-trust-m77zvk-76c5c5ef.png",
    kind: "stock",
    categories: ["Stocks"],
    tags: ["Verified", "Token2022"],
    decimals: 9,
    mints: {
      mainnet: "M77ZvkZ8zW5udRbuJCbuwSwavRa7bGAZYMTwru8ondo",
    },
  },
  {
    name: "IBM",
    symbol: "IBMON",
    id: "ibm-ondo-tokenized-stock",
    logo: "/logos/ibmon-ibm-c8bzkg-184ad371.png",
    kind: "stock",
    categories: ["Stocks"],
    tags: ["Verified", "Token2022"],
    decimals: 9,
    mints: {
      mainnet: "C8bZkgSxXkyT1RgxByp2teJ24hgimPLoyEYoNa9ondo",
    },
  },
  {
    name: "iShares Core MSCI EAFE ETF",
    symbol: "IEFAON",
    id: "ishares-core-msci-eafe-etf-ondo-tokenized-etf",
    logo: "/logos/iefaon-ishares-core-msci-eafe-etf-c9j9vz-ba6e877c.png",
    kind: "stock",
    categories: ["ETF"],
    tags: ["Verified", "Token2022"],
    decimals: 9,
    mints: {
      mainnet: "C9J9vZ8N79GzzxFoRkPWCkGtMKU8akg4FhUk4r9ondo",
    },
  },
  {
    name: "iShares Core MSCI Emerging Markets ETF",
    symbol: "IEMGON",
    id: "ishares-core-msci-emerging-markets-etf-ondo-tokenized-etf",
    logo: "/logos/iemgon-ishares-core-msci-emerging-markets-etf-cdvnl7-f35055f6.png",
    kind: "stock",
    categories: ["ETF"],
    tags: ["Verified", "Token2022"],
    decimals: 9,
    mints: {
      mainnet: "cdVNL7wK8mf1UCDqM6zdrziRv4hmvqWhXeTcck2ondo",
    },
  },
  {
    name: "iShares Core S&P MidCap ETF",
    symbol: "IJHON",
    id: "ishares-core-s-p-midcap-etf-ondo-tokenized-etf",
    logo: "/logos/ijhon-ishares-core-s-p-midcap-etf-cfpln9-38dbded5.png",
    kind: "stock",
    categories: ["ETF"],
    tags: ["Verified", "Token2022"],
    decimals: 9,
    mints: {
      mainnet: "cfPLN9WXD2BTkbZhRZMVXPmVSiRo44hJWRtnaC8ondo",
    },
  },
  {
    name: "Intel",
    symbol: "INTCON",
    id: "intel-ondo-tokenized-stock",
    logo: "/logos/intcon-intel-cjpump-c579ef4b.png",
    kind: "stock",
    categories: ["Stocks"],
    tags: ["Verified", "Token2022"],
    decimals: 9,
    mints: {
      mainnet: "cJpUMp5R7rZ6fGeLHbHhrRuJzK9mkyKDjZqNpT3ondo",
    },
  },
  {
    name: "Intuit",
    symbol: "INTUON",
    id: "intuit-ondo-tokenized-stock",
    logo: "/logos/intuon-intuit-cozoh5-2c761350.png",
    kind: "stock",
    categories: ["Stocks"],
    tags: ["Verified", "Token2022"],
    decimals: 9,
    mints: {
      mainnet: "CozoH5HBTyyeYSQxHcWpGzd4Sq5XBaKzBzvTtN3ondo",
    },
  },
  {
    name: "IREN",
    symbol: "IRENON",
    id: "iren-ondo-tokenized-stock",
    logo: "/logos/irenon-iren-13qhue-b613e194.png",
    kind: "stock",
    categories: ["Stocks"],
    tags: ["Verified", "Token2022"],
    decimals: 9,
    mints: {
      mainnet: "13QHuepdhtJ3urNsV9i1hdL8nQoca2G7ZaLzb5FYondo",
    },
  },
  
  {
    name: "iShares Core S&P Total US Stock Market ETF",
    symbol: "ITOTON",
    id: "ishares-core-s-p-total-us-stock-market-etf-ondo-tokenized-etf",
    logo: "/logos/itoton-ishares-core-s-p-total-us-stock-market-etf-cpwkmu-b900aca3.png",
    kind: "stock",
    categories: ["ETF"],
    tags: ["Token2022", "Verified"],
    decimals: 9,
    mints: {
      mainnet: "CPWkMURVvcnX8hGjqCTb8i5LkzV3VSvyk7SeJi8ondo",
    },
  },
  {
    name: "iShares Core S&P 500 ETF",
    symbol: "IVVON",
    id: "ishares-core-s-p-500-etf-ondo-tokenized-etf",
    logo: "/logos/ivvon-ishares-core-s-p-500-etf-cqw2pd-08390f76.png",
    kind: "stock",
    categories: ["ETF"],
    tags: ["Token2022", "Verified"],
    decimals: 9,
    mints: {
      mainnet: "CqW2pd6dCPG9xKZfAsTovzDsMmAGKJSDBNcwM96ondo",
    },
  },
  {
    name: "iShares Russell 1000 Growth ETF",
    symbol: "IWFON",
    id: "ishares-russell-1000-growth-etf-ondo-tokenized-etf",
    logo: "/logos/iwfon-ishares-russell-1000-growth-etf-dshpfu-f7e08d57.png",
    kind: "stock",
    categories: ["ETF"],
    tags: ["Verified", "Token2022"],
    decimals: 9,
    mints: {
      mainnet: "dSHPFuMMjZqt7xDYGWrexXTSkdEZAiZngqymQF2ondo",
    },
  },
  {
    name: "iShares Russell 2000 ETF",
    symbol: "IWMON",
    id: "ishares-russell-2000-etf-ondo-tokenized-etf",
    logo: "/logos/iwmon-ishares-russell-2000-etf-dvj2kk-8d4bedd1.png",
    kind: "stock",
    categories: ["ETF"],
    tags: ["Verified", "Token2022"],
    decimals: 9,
    mints: {
      mainnet: "dvj2kKFSyjpnyYSYppgFdAEVfgjMEoQGi9VaV23ondo",
    },
  },
  {
    name: "iShares Russell 2000 Value ETF",
    symbol: "IWNON",
    id: "ishares-russell-2000-value-etf-ondo-tokenized-etf",
    logo: "/logos/iwnon-ishares-russell-2000-value-etf-dx7g7w-d9ac31ce.png",
    kind: "stock",
    categories: ["ETF"],
    tags: ["Verified", "Token2022"],
    decimals: 9,
    mints: {
      mainnet: "DX7g7WNjDpVzNK9CG81v7wb6ZbiNzYfkdzH2Xs5ondo",
    },
  },
  
  {
    name: "JD.com",
    symbol: "JDON",
    id: "jd-com-ondo-tokenized-stock",
    logo: "/logos/jdon-jd-com-e1aus5-c3102c77.png",
    kind: "stock",
    categories: ["Stocks"],
    tags: ["Verified", "Token2022"],
    decimals: 9,
    mints: {
      mainnet: "E1aUS5nyv7kaBzdQzPVJW5zfaMgoUJpKYzdnFS2ondo",
    },
  },
  {
    name: "Johnson & Johnson",
    symbol: "JNJON",
    id: "johnson-johnson-ondo-tokenized-stock",
    logo: "/logos/jnjon-johnson-johnson-kuxt7l-50fc05ee.png",
    kind: "stock",
    categories: ["Stocks"],
    tags: ["Verified", "Token2022"],
    decimals: 9,
    mints: {
      mainnet: "KUXt7LzHWSQXp5eyqMZRxWjAP6yM8BUh4LRHwiwondo",
    },
  },
  {
    name: "JPMorgan Chase",
    symbol: "JPMON",
    id: "jpmorgan-chase-ondo-tokenized-stock",
    logo: "/logos/jpmon-jpmorgan-chase-e5gczs-04675ab8.png",
    kind: "stock",
    categories: ["Stocks"],
    tags: ["Verified", "Token2022"],
    decimals: 9,
    mints: {
      mainnet: "E5Gczsavxcomqf6Cw1sGCKLabL1xYD2FzKxVoB4ondo",
    },
  },
  
  {
    name: "Coca-Cola",
    symbol: "KOON",
    id: "coca-cola-ondo-tokenized-stock",
    logo: "/logos/koon-coca-cola-e6g4pf-778a4231.png",
    kind: "stock",
    categories: ["Stocks"],
    tags: ["Verified", "Token2022"],
    decimals: 9,
    mints: {
      mainnet: "e6G4pfFcrdKxJuZ4YXixRFfMbpMvgXG2Mjcus71ondo",
    },
  },
  {
    name: "Linde plc",
    symbol: "LINON",
    id: "linde-plc-ondo-tokenized-stock",
    logo: "/logos/linon-linde-plc-edik9m-5ad9f05a.png",
    kind: "stock",
    categories: ["Stocks"],
    tags: ["Verified", "Token2022"],
    decimals: 9,
    mints: {
      mainnet: "Edik9MoFp8LAXS9HNu2gRFyihwYqDqv4ZmNmVT9ondo",
    },
  },
  
  {
    name: "Eli Lilly",
    symbol: "LLYON",
    id: "eli-lilly-ondo-tokenized-stock",
    logo: "/logos/llyon-eli-lilly-eggxzw-92222561.png",
    kind: "stock",
    categories: ["Stocks"],
    tags: ["Verified", "Token2022"],
    decimals: 9,
    mints: {
      mainnet: "eGGxZwNSfuNKRqQLKaz2hc4QkA2mau7skyxPdj7ondo",
    },
  },
  {
    name: "Lockheed",
    symbol: "LMTON",
    id: "lockheed-ondo-tokenized-stock",
    logo: "/logos/lmton-lockheed-eorehw-7cc92429.png",
    kind: "stock",
    categories: ["Stocks"],
    tags: ["Verified", "Token2022"],
    decimals: 9,
    mints: {
      mainnet: "EoReHwUnGGekbXFHLj5rbCVKiwWqu32GrETMfw4ondo",
    },
  },
  
  {
    name: "Mastercard",
    symbol: "MAON",
    id: "mastercard-ondo-tokenized-stock",
    logo: "/logos/maon-mastercard-esvhcy-043f4d47.png",
    kind: "stock",
    categories: ["Stocks"],
    tags: ["Verified", "Token2022"],
    decimals: 9,
    mints: {
      mainnet: "EsVHcyRxXFJCLMiuYLWhoDygrNe1BJGpYeZ17X7ondo",
    },
  },
  {
    name: "MARA Holdings",
    symbol: "MARAON",
    id: "mara-holdings-ondo-tokenized-stock",
    logo: "/logos/maraon-mara-holdings-etcjum-220c5512.png",
    kind: "stock",
    categories: ["Stocks"],
    tags: ["Verified", "Token2022"],
    decimals: 9,
    mints: {
      mainnet: "ETCJUmuhs5aY62xgEVWCZ5JR8KPdeXUaJz3LuC5ondo",
    },
  },
  {
    name: "McDonald's",
    symbol: "MCDON",
    id: "mcdonald-s-ondo-tokenized-stock",
    logo: "/logos/mcdon-mcdonald-eubjjm-07ecadc4.png",
    kind: "stock",
    categories: ["Stocks"],
    tags: ["Verified", "Token2022"],
    decimals: 9,
    mints: {
      mainnet: "EUbJjmDt8JA222M91bVLZs211siZ2jzbFArH9N3ondo",
    },
  },
  {
    name: "MercadoLibre",
    symbol: "MELION",
    id: "mercadolibre-ondo-tokenized-stock",
    logo: "/logos/melion-mercadolibre-ewwdgg-f2d2eca1.png",
    kind: "stock",
    categories: ["Stocks"],
    tags: ["Verified", "Token2022"],
    decimals: 9,
    mints: {
      mainnet: "EWwdgGshGngcMpDV34pWZRSu5bkAuiKuKTTHKQ8ondo",
    },
  },
  {
    name: "Meta Platforms",
    symbol: "METAON",
    id: "meta-platforms-ondo-tokenized-stock",
    logo: "/logos/metaon-meta-platforms-fdxs5y-98eaa79b.png",
    kind: "stock",
    categories: ["Stocks"],
    tags: ["Verified", "Token2022"],
    decimals: 9,
    mints: {
      mainnet: "fDxs5y12E7x7jBwCKBXGqt71uJmCWsAQ3Srkte6ondo",
    },
  },
  
  {
    name: "Marvell Technology",
    symbol: "MRVLON",
    id: "marvell-technology-ondo-tokenized-stock",
    logo: "/logos/mrvlon-marvell-technology-fovbwh-5719fb6e.png",
    kind: "stock",
    categories: ["Stocks"],
    tags: ["Token2022", "Verified"],
    decimals: 9,
    mints: {
      mainnet: "FovBwhoV5KQjZCdhoM6jgXYwXLX3F8vgAfvmLH7ondo",
    },
  },
  {
    name: "Microsoft",
    symbol: "MSFTON",
    id: "microsoft-ondo-tokenized-stock",
    logo: "/logos/msfton-microsoft-frmh6i-dda334a5.png",
    kind: "stock",
    categories: ["Stocks"],
    tags: ["Verified", "Token2022"],
    decimals: 9,
    mints: {
      mainnet: "FRmH6iRkMr33DLG6zVLR7EM4LojBFAuq6NtFzG6ondo",
    },
  },
  {
    name: "MicroStrategy",
    symbol: "MSTRON",
    id: "microstrategy-ondo-tokenized-stock",
    logo: "/logos/mstron-microstrategy-fsz4ou-189e17a0.png",
    kind: "stock",
    categories: ["Stocks"],
    tags: ["Verified", "Token2022"],
    decimals: 9,
    mints: {
      mainnet: "FSz4ouiqXpHuGPcpacZfTzbMjScoj5FfzHkiyu2ondo",
    },
  },
  
  {
    name: "Micron Technology",
    symbol: "MUON",
    id: "micron-technology-ondo-tokenized-stock",
    logo: "/logos/muon-micron-technology-fz9edb-a0bf97e3.png",
    kind: "stock",
    categories: ["Stocks"],
    tags: ["Verified", "Token2022"],
    decimals: 9,
    mints: {
      mainnet: "Fz9edBpaURPPzpKVRR1A8PENYDEgHqwx5D5th28ondo",
    },
  },
  
  {
    name: "Netflix",
    symbol: "NFLXON",
    id: "netflix-ondo-tokenized-stock",
    logo: "/logos/nflxon-netflix-g4knpr-a3c9d381.png",
    kind: "stock",
    categories: ["Stocks"],
    tags: ["Token2022", "Verified"],
    decimals: 9,
    mints: {
      mainnet: "g4KnPrxPLeeKkwvDmZFMtYQPM64eHeShbD55vK6ondo",
    },
  },
  
  {
    name: "Nike",
    symbol: "NKEON",
    id: "nike-ondo-tokenized-stock",
    logo: "/logos/nkeon-nike-g646pc-d906cf97.png",
    kind: "stock",
    categories: ["Stocks"],
    tags: ["Verified", "Token2022"],
    decimals: 9,
    mints: {
      mainnet: "g646pcdG2Rt5DH9WZzL7VVnVDWCCMTTrnktwE74ondo",
    },
  },
  {
    name: "ServiceNow",
    symbol: "NOWON",
    id: "servicenow-ondo-tokenized-stock",
    logo: "/logos/nowon-servicenow-g7ptvo-8e40a424.png",
    kind: "stock",
    categories: ["Stocks"],
    tags: ["Token2022", "Verified"],
    decimals: 9,
    mints: {
      mainnet: "G7pTVoSECz5RQWubEnTP7AC83KHUsSyoiqYR1R2ondo",
    },
  },
  
  {
    name: "NVIDIA",
    symbol: "NVDAON",
    id: "nvidia-ondo-tokenized-stock",
    logo: "/logos/nvdaon-nvidia-gegtlt-408d5132.png",
    kind: "stock",
    categories: ["Stocks"],
    tags: ["Verified", "Token2022"],
    decimals: 9,
    mints: {
      mainnet: "gEGtLTPNQ7jcg25zTetkbmF7teoDLcrfTnQfmn2ondo",
    },
  },
  {
    name: "Novo Nordisk",
    symbol: "NVOON",
    id: "novo-nordisk-ondo-tokenized-stock",
    logo: "/logos/nvoon-novo-nordisk-gev7s8-db66c05f.png",
    kind: "stock",
    categories: ["Stocks"],
    tags: ["Verified", "Token2022"],
    decimals: 9,
    mints: {
      mainnet: "GeV7S8vjP8qdYZpdGv2Xi6e7MUMCk8NAAp2z7g5ondo",
    },
  },
  {
    name: "Oklo ",
    symbol: "OKLOON",
    id: "oklo-ondo-tokenized",
    logo: "/logos/okloon-oklo-m6odlv-2afdbfd1.png",
    kind: "stock",
    categories: ["Stocks"],
    tags: ["Verified", "Token2022"],
    decimals: 9,
    mints: {
      mainnet: "m6oDLvJT7rY7M1TxuLWP3pWmAPg2cCWDQR1NKiEondo",
    },
  },
 
  {
    name: "ON Semiconductor ",
    symbol: "ONON",
    id: "on-semiconductor-ondo-tokenized",
    logo: "/logos/onon-on-semiconductor-13qtwy-1573cb19.png",
    kind: "stock",
    categories: ["Stocks"],
    tags: ["Verified", "Token2022"],
    decimals: 9,
    mints: {
      mainnet: "13qtwy5fZi9Przz14pzo9xqFSr8QHmLyUpUCvP1xondo",
    },
  },
  
  {
    name: "Oracle",
    symbol: "ORCLON",
    id: "oracle-ondo-tokenized-stock",
    logo: "/logos/orclon-oracle-gmdadf-57fdad70.png",
    kind: "stock",
    categories: ["Stocks"],
    tags: ["Verified", "Token2022"],
    decimals: 9,
    mints: {
      mainnet: "GmDADFpfwjfzZq9MfCafMDTS69MgVjtzD7Fd9a4ondo",
    },
  },
  
  {
    name: "Occidental Petroleum",
    symbol: "OXYON",
    id: "occidental-petroleum-ondo-tokenized",
    logo: "/logos/oxyon-occidental-petroleum-1gnfmr-199d22d3.png",
    kind: "stock",
    categories: ["Stocks"],
    tags: ["Verified", "Token2022"],
    decimals: 9,
    mints: {
      mainnet: "1GNFMryQ6c9ZpMhgNimmsbtgYM21qnBJgRAFoNiondo",
    },
  },
  
  {
    name: "Palo Alto Networks",
    symbol: "PANWON",
    id: "palo-alto-networks-ondo-tokenized-stock",
    logo: "/logos/panwon-palo-alto-networks-m7hvqo-247e3b83.png",
    kind: "stock",
    categories: ["Stocks"],
    tags: ["Verified", "Token2022"],
    decimals: 9,
    mints: {
      mainnet: "M7hVQomhw4Q2D2op3HvBrZjHu9SryjNvD5haEZ1ondo",
    },
  },
  {
    name: "Petrobras",
    symbol: "PBRON",
    id: "petrobras-ondo-tokenized-stock",
    logo: "/logos/pbron-petrobras-grcifc-e9c2ccf3.png",
    kind: "stock",
    categories: ["Stocks"],
    tags: ["Verified", "Token2022"],
    decimals: 9,
    mints: {
      mainnet: "GRciFCqJ5y2hbiD6U5mGkohY65BZTXGuGUrCqf7ondo",
    },
  },
  
  {
    name: "PepsiCo",
    symbol: "PEPON",
    id: "pepsico-ondo-tokenized-stock",
    logo: "/logos/pepon-pepsico-gud6b3-cd21f6de.png",
    kind: "stock",
    categories: ["Stocks"],
    tags: ["Verified", "Token2022"],
    decimals: 9,
    mints: {
      mainnet: "gud6b3fYekjhMG5F818BALwbg2vt4JKoow59Md9ondo",
    },
  },
  {
    name: "Pfizer",
    symbol: "PFEON",
    id: "pfizer-ondo-tokenized-stock",
    logo: "/logos/pfeon-pfizer-gwh9fp-6279ef30.png",
    kind: "stock",
    categories: ["Stocks"],
    tags: ["Verified", "Token2022"],
    decimals: 9,
    mints: {
      mainnet: "Gwh9fPsX1qWATXy63vNaJnAFfwebWQtZaVmPko6ondo",
    },
  },
  {
    name: "Procter & Gamble",
    symbol: "PGON",
    id: "procter-gamble-ondo-tokenized-stock",
    logo: "/logos/pgon-procter-gamble-gz8v4n-99ae72f8.png",
    kind: "stock",
    categories: ["Stocks"],
    tags: ["Verified", "Token2022"],
    decimals: 9,
    mints: {
      mainnet: "GZ8v4NdSG7CTRZqHMgNsTPRULeVi8CpdWd9wZY8ondo",
    },
  },
  
  {
    name: "Palantir Technologies",
    symbol: "PLTRON",
    id: "palantir-technologies-ondo-tokenized-stock",
    logo: "/logos/pltron-palantir-technologies-hfsnts-a3adec6e.png",
    kind: "stock",
    categories: ["Stocks"],
    tags: ["Verified", "Token2022"],
    decimals: 9,
    mints: {
      mainnet: "HfsnTS5qtdStwec9DfBrunRqnAMYMMz1kjv9Hu9ondo",
    },
  },

  
  {
    name: "PayPal",
    symbol: "PYPLON",
    id: "paypal-ondo-tokenized-stock",
    logo: "/logos/pyplon-paypal-hm7b3u-9ef93d68.png",
    kind: "stock",
    categories: ["Stocks"],
    tags: ["Verified", "Token2022"],
    decimals: 9,
    mints: {
      mainnet: "hM7B3UQTTR81mS27SxDDPzBbjejmo8fnpFjzgv9ondo",
    },
  },
  {
    name: "D-Wave Quantum",
    symbol: "QBTSON",
    id: "d-wave-quantum-ondo-tokenized-stock",
    logo: "/logos/qbtson-d-wave-quantum-hqjxut-1c940bac.png",
    kind: "stock",
    categories: ["Stocks"],
    tags: ["Verified", "Token2022"],
    decimals: 9,
    mints: {
      mainnet: "hqJXutLF6f7DxStrWCrnZDfXzbNTZmvi3KheVi6ondo",
    },
  },
  {
    name: "Qualcomm",
    symbol: "QCOMON",
    id: "qualcomm-ondo-tokenized-stock",
    logo: "/logos/qcomon-qualcomm-hrmx7m-e10ed40b.png",
    kind: "stock",
    categories: ["Stocks"],
    tags: ["Verified", "Token2022"],
    decimals: 9,
    mints: {
      mainnet: "hrmX7MV5hifoaBVjnrdpz698yABxrbBNAcWtWo9ondo",
    },
  },
  {
    name: "Invesco QQQ ETF",
    symbol: "QQQON",
    id: "invesco-qqq-etf-ondo-tokenized-etf",
    logo: "/logos/qqqon-invesco-qqq-etf-hrynm6-d2a7dc66.png",
    kind: "stock",
    categories: ["ETF"],
    tags: ["Verified", "Token2022"],
    decimals: 9,
    mints: {
      mainnet: "HrYNm6jTQ71LoFphjVKBTdAE4uja7WsmLG8VxB8ondo",
    },
  },
  {
    name: "Reddit",
    symbol: "RDDTON",
    id: "reddit-ondo-tokenized-stock",
    logo: "/logos/rddton-reddit-hxfrtf-f1b211e1.png",
    kind: "stock",
    categories: ["Stocks"],
    tags: ["Verified", "Token2022"],
    decimals: 9,
    mints: {
      mainnet: "HXFrTf9v9NdjGUTnx4sojR3Cf92hoBsQFUxKTN7ondo",
    },
  },
  {
    name: "VanEck Rare Earth and Strategic Metals ETF",
    symbol: "REMXON",
    id: "vaneck-rare-earth-and-strategic-metals-etf-ondo-tokenized",
    logo: "/logos/remxon-vaneck-rare-earth-and-strategic-metals-etf-tiitb2-f2710336.png",
    kind: "stock",
    categories: ["ETF"],
    tags: ["Verified", "Token2022"],
    decimals: 9,
    mints: {
      mainnet: "tiitb2Z1HtpB2DpVr6V7tdCFS3jmTinLeuGj9EVondo",
    },
  },
  
  {
    name: "Riot Platforms",
    symbol: "RIOTON",
    id: "riot-platforms-ondo-tokenized-stock",
    logo: "/logos/rioton-riot-platforms-i6f3dv-4aa425e4.png",
    kind: "stock",
    categories: ["Stocks"],
    tags: ["Verified", "Token2022"],
    decimals: 9,
    mints: {
      mainnet: "i6f3DvZBuLpnGSqS8x6WPeStJ7jNe5KewD6afD5ondo",
    },
  },
  {
    name: "Rivian Automotive",
    symbol: "RIVNON",
    id: "rivian-automotive-ondo-tokenized",
    logo: "/logos/rivnon-rivian-automotive-axrsyf-d07ce269.png",
    kind: "stock",
    categories: ["Stocks"],
    tags: ["Token2022", "Verified"],
    decimals: 9,
    mints: {
      mainnet: "AXRsYFt7TXNQ3DcY6BkvRgPV6VsYMURyDtaeudjondo",
    },
  },
  {
    name: "RTX ",
    symbol: "RTXON",
    id: "rtx-ondo-tokenized",
    logo: "/logos/rtxon-rtx-12bvlz-15ce598a.png",
    kind: "stock",
    categories: ["Stocks"],
    tags: ["Verified", "Token2022"],
    decimals: 9,
    mints: {
      mainnet: "12BvLZtzjdssAycxPeBQUjukhmgQpULAvy6SroYdondo",
    },
  },
  {
    name: "SharpLink Gaming, Inc",
    symbol: "SBETON",
    id: "sharplink-gaming-inc-ondo-tokenized-stock",
    logo: "/logos/sbeton-sharplink-gaming-inc-ildu2j-486561e0.png",
    kind: "stock",
    categories: ["Stocks"],
    tags: ["Verified", "Token2022"],
    decimals: 9,
    mints: {
      mainnet: "iLDu2jjp2i3Uqc2Vm7K7GLiUj3hR4Un49MtD7c4ondo",
    },
  },
  {
    name: "Starbucks",
    symbol: "SBUXON",
    id: "starbucks-ondo-tokenized-stock",
    logo: "/logos/sbuxon-starbucks-ipfqjc-e3c92269.png",
    kind: "stock",
    categories: ["Stocks"],
    tags: ["Verified", "Token2022"],
    decimals: 9,
    mints: {
      mainnet: "iPFqjcZQTNMNXA4kbShbMhfAVD8yr8Uq9UtXMV6ondo",
    },
  },
  
  {
    name: "iShares 0-3 Month Treasury Bond ETF",
    symbol: "SGOVON",
    id: "ishares-0-3-month-treasury-bond-etf-ondo-tokenized-etf",
    logo: "/logos/sgovon-ishares-0-3-month-treasury-bond-etf-hjrn6c-37bcfb45.png",
    kind: "stock",
    categories: ["ETF"],
    tags: ["Verified", "Token2022"],
    decimals: 9,
    mints: {
      mainnet: "HjrN6ChZK2QRL6hMXayjGPLFvxhgjwKEy135VRjondo",
    },
  },
  {
    name: "Shopify",
    symbol: "SHOPON",
    id: "shopify-ondo-tokenized-stock",
    logo: "/logos/shopon-shopify-ivddra-2830c8e2.png",
    kind: "stock",
    categories: ["Stocks"],
    tags: ["Token2022", "Verified"],
    decimals: 9,
    mints: {
      mainnet: "ivdDracs2s7jCP698dJXKSEQdVrNj9hasJL1Uq1ondo",
    },
  },
  {
    name: "iShares Silver Trust",
    symbol: "SLVON",
    id: "ishares-silver-trust-ondo-tokenized-stock",
    logo: "/logos/slvon-ishares-silver-trust-iy11yt-488597e8.png",
    kind: "stock",
    categories: ["Stocks"],
    tags: ["Verified", "Token2022"],
    decimals: 9,
    mints: {
      mainnet: "iy11ytbSGcUnrjE6Lfv78TFqxKyUESfku1FugS9ondo",
    },
  },
  {
    name: "Super Micro Computer",
    symbol: "SMCION",
    id: "super-micro-computer-ondo-tokenized-stock",
    logo: "/logos/smcion-super-micro-computer-jlca79-b08d697e.png",
    kind: "stock",
    categories: ["Stocks"],
    tags: ["Verified", "Token2022"],
    decimals: 9,
    mints: {
      mainnet: "jLca79XzcewRuBZyaJxVxuKpUHcEix1X4CP1RP9ondo",
    },
  },
  
  {
    name: "Snowflake",
    symbol: "SNOWON",
    id: "snowflake-ondo-tokenized-stock",
    logo: "/logos/snowon-snowflake-jmflcb-f0753ee9.png",
    kind: "stock",
    categories: ["Stocks"],
    tags: ["Verified", "Token2022"],
    decimals: 9,
    mints: {
      mainnet: "JmFLCBwoNvcXy6B2VqABg6m784ubkXpaEx3p7S5ondo",
    },
  },

  {
    name: "S&P Global",
    symbol: "SPGION",
    id: "s-p-global-ondo-tokenized-stock",
    logo: "/logos/spgion-s-p-global-jrtyw7-21e45ee8.png",
    kind: "stock",
    categories: ["Stocks"],
    tags: ["Verified", "Token2022"],
    decimals: 9,
    mints: {
      mainnet: "JrTYw7A9jihX5TwpRStYviEbsYf2X2VJpZ13719ondo",
    },
  },
  {
    name: "Spotify",
    symbol: "SPOTON",
    id: "spotify-ondo-tokenized-stock",
    logo: "/logos/spoton-spotify-jzcvs2-c4618c1b.png",
    kind: "stock",
    categories: ["Stocks"],
    tags: ["Verified", "Token2022"],
    decimals: 9,
    mints: {
      mainnet: "jzCvs2Pk8tDcfsFRqnEMjurgaQW4iQfEkandUR8ondo",
    },
  },
  {
    name: "SPDR S&P 500 ETF",
    symbol: "SPYON",
    id: "spdr-s-p-500-etf-ondo-tokenized-etf",
    logo: "/logos/spyon-spdr-s-p-500-etf-k18wju-0c1967fd.png",
    kind: "stock",
    categories: ["ETF"],
    tags: ["Token2022", "Verified"],
    decimals: 9,
    mints: {
      mainnet: "k18WJUULWheRkSpSquYGdNNmtuE2Vbw1hpuUi92ondo",
    },
  },
  {
    name: "ProShares UltraPro Short QQQ ",
    symbol: "SQQQON",
    id: "proshares-ultrapro-short-qqq-ondo-tokenized",
    logo: "/logos/sqqqon-proshares-ultrapro-short-qqq-d1tu7f-2d2f7975.png",
    kind: "stock",
    categories: ["Stocks", "Fund"],
    tags: ["Verified", "Token2022"],
    decimals: 9,
    mints: {
      mainnet: "D1tu7Fnm3cCpKyyPXrqm5GXShPqMj7a2SEjjq9fondo",
    },
  },
  
  {
    name: "iShares TIPS Bond ETF",
    symbol: "TIPON",
    id: "ishares-tips-bond-etf-ondo-tokenized-etf",
    logo: "/logos/tipon-ishares-tips-bond-etf-k6bpp2-9f9a1c54.png",
    kind: "stock",
    categories: ["ETF"],
    tags: ["Verified", "Token2022"],
    decimals: 9,
    mints: {
      mainnet: "k6BPp2Xmf2TYgrZiUyWfUoZBKeqaDbvPoAVgSx2ondo",
    },
  },
  
  {
    name: "iShares 20+ Year Treasury Bond ETF",
    symbol: "TLTON",
    id: "ishares-20-year-treasury-bond-etf-ondo-tokenized-etf",
    logo: "/logos/tlton-ishares-20-year-treasury-bond-etf-kaslsw-a57d9c13.png",
    kind: "stock",
    categories: ["ETF"],
    tags: ["Verified", "Token2022"],
    decimals: 9,
    mints: {
      mainnet: "KaSLSWByKy6b9FrCYXPEJoHmLpuFZtTCJk1F1Z9ondo",
    },
  },
  {
    name: "Toyota",
    symbol: "TMON",
    id: "toyota-ondo-tokenized-stock",
    logo: "/logos/tmon-toyota-kbmf7e-a612c171.png",
    kind: "stock",
    categories: ["Stocks"],
    tags: ["Verified", "Token2022"],
    decimals: 9,
    mints: {
      mainnet: "kbmF7ERJWMaaDswMprrH9gHSLya5D2RMBNgKqg3ondo",
    },
  },
  {
    name: "Thermo Fisher Scientific",
    symbol: "TMOON",
    id: "thermo-fisher-scientific-ondo-tokenized-stock",
    logo: "/logos/tmoon-thermo-fisher-scientific-t699bg-73c2091f.webp",
    kind: "stock",
    categories: ["Stocks"],
    tags: ["Verified", "Token2022"],
    decimals: 9,
    mints: {
      mainnet: "T699bgtXQw4CJ59rQ4VzLsupVQUzoL5RmuhHnKrondo",
    },
  },
  
  {
    name: "AT&T",
    symbol: "TON",
    id: "atnt-ondo-tokenized-stock",
    logo: "/logos/ton-at-t-wkmzum-f966bc56.webp",
    kind: "stock",
    categories: ["Stocks"],
    tags: ["Verified", "Token2022"],
    decimals: 9,
    mints: {
      mainnet: "WKMZummev5UcXz5nNKQZvTD6QjNSM2X58uwmDReondo",
    },
  },
  {
    name: "ProShares UltraPro QQQ ",
    symbol: "TQQQON",
    id: "proshares-ultrapro-qqq-ondo-tokenized",
    logo: "/logos/tqqqon-proshares-ultrapro-qqq-14w1it-011f8993.png",
    kind: "stock",
    categories: ["Stocks", "Fund"],
    tags: ["Verified", "Token2022"],
    decimals: 9,
    mints: {
      mainnet: "14W1itEkV7k1W819mLSknFTaMmkCtPokbF2tRkPUondo",
    },
  },
  {
    name: "Tesla",
    symbol: "TSLAON",
    id: "tesla-ondo-tokenized-stock",
    logo: "/logos/tslaon-tesla-kegv7b-577d5464.png",
    kind: "stock",
    categories: ["Stocks"],
    tags: ["Verified", "Token2022"],
    decimals: 9,
    mints: {
      mainnet: "KeGv7bsfR4MheC1CkmnAVceoApjrkvBhHYjWb67ondo",
    },
  },
  {
    name: "Taiwan Semiconductor Manufacturing",
    symbol: "TSMON",
    id: "taiwan-semiconductor-manufacturing-ondo-tokenized-stock",
    logo: "/logos/tsmon-taiwan-semiconductor-manufacturing-keybg1-3a985bcd.png",
    kind: "stock",
    categories: ["Stocks"],
    tags: ["Token2022", "Verified"],
    decimals: 9,
    mints: {
      mainnet: "keybg184d4vyXeQdFqs4o99YsMg7xBthxTJ6Ky3ondo",
    },
  },
  
  {
    name: "WisdomTree Floating Rate Treasury Fund (Ondo Tokenized)",
    symbol: "USFRON",
    id: "wisdomtree-floating-rate-treasury-fund-ondo-tokenized",
    logo: "/logos/usfron-wisdomtree-floating-rate-treasury-fund-ondo-tokenized-o6u1sm-8fda984d.png",
    kind: "stock",
    categories: ["Stocks", "Fund"],
    tags: ["Verified", "Token2022"],
    decimals: 9,
    mints: {
      mainnet: "o6U1Sm6Vd7EofMyCrL28mrp2QLzgYGgjveHiEQ5ondo",
    },
  },
  
  {
    name: "Visa",
    symbol: "VON",
    id: "visa-ondo-tokenized-stock",
    logo: "/logos/von-visa-kxew4o-f35211c4.png",
    kind: "stock",
    categories: ["Stocks"],
    tags: ["Verified", "Token2022"],
    decimals: 9,
    mints: {
      mainnet: "kxEW4oJL75K37VeXaZF1ynbHQATQwhECQKN1374ondo",
    },
  },
  {
    name: "Vertiv (Ondo Tokenized)",
    symbol: "VRTON",
    id: "vertiv-ondo-tokenized",
    logo: "/logos/vrton-vertiv-ondo-tokenized-mkn2tz-7907f48b.png",
    kind: "stock",
    categories: ["Stocks"],
    tags: ["Verified", "Token2022"],
    decimals: 9,
    mints: {
      mainnet: "MkN2TZSYTFBdMRLf9EVcfhstTwnazH8knd9hpepondo",
    },
  },
  {
    name: "Vistra (Ondo Tokenized)",
    symbol: "VSTON",
    id: "vistra-ondo-tokenized",
    logo: "/logos/vston-vistra-ondo-tokenized-h6mw8g-0e73ae11.png",
    kind: "stock",
    categories: ["Stocks"],
    tags: ["Verified", "Token2022"],
    decimals: 9,
    mints: {
      mainnet: "h6MW8GFpfzxFa1JNn6hZNnBF3t4fj9SHAXKy6LXondo",
    },
  },
  {
    name: "Vanguard Total Stock Market ETF (Ondo Tokenized)",
    symbol: "VTION",
    id: "vanguard-total-stock-market-etf-ondo-tokenized",
    logo: "/logos/vtion-vanguard-total-stock-market-etf-ondo-tokenized-jccu4g-4cabb6e9.png",
    kind: "stock",
    categories: ["Stocks", "ETF"],
    tags: ["Verified", "Token2022"],
    decimals: 9,
    mints: {
      mainnet: "jCCU4GwukjNxAXJowG2S4KCrr5g6YyUB61WHYvGondo",
    },
  },
  {
    name: "Vanguard Value ETF (Ondo Tokenized)",
    symbol: "VTVON",
    id: "vanguard-value-etf-ondo-tokenized",
    logo: "/logos/vtvon-vanguard-value-etf-ondo-tokenized-kuiylp-e40f3fb3.png",
    kind: "stock",
    categories: ["ETF", "Stocks"],
    tags: ["Verified", "Token2022"],
    decimals: 9,
    mints: {
      mainnet: "KuiYLPVq65qixD9TgvxBC576C4gG6vVTCdbh2zFondo",
    },
  },
  
  {
    name: "Walmart",
    symbol: "WMTON",
    id: "walmart-ondo-tokenized-stock",
    logo: "/logos/wmton-walmart-lzddqa-690ba989.png",
    kind: "stock",
    categories: ["Stocks"],
    tags: ["Verified", "Token2022"],
    decimals: 9,
    mints: {
      mainnet: "LZddqAqKqJW9oMZSjTxCUmbmzBRQtv9gMkD9hZ3ondo",
    },
  },
  
  {
    name: "Exxon Mobil",
    symbol: "XOMON",
    id: "exxon-mobil-ondo-tokenized-stocks",
    logo: "/logos/xomon-exxon-mobil-qcyd74-e170292f.png",
    kind: "stock",
    categories: ["Stocks"],
    tags: ["Verified", "Token2022"],
    decimals: 9,
    mints: {
      mainnet: "qCYD74QnXzd9pzv6pGHQKJVwoibL6sNcPQDnpDiondo",
    },
  },
  {
    name: "Block",
    symbol: "XYZON",
    id: "block-ondo-tokenized-stocks",
    logo: "/logos/xyzon-block-bwxe2f-c1d9fd35.png",
    kind: "stock",
    categories: ["Stocks"],
    tags: ["Verified", "Token2022"],
    decimals: 9,
    mints: {
      mainnet: "BWxe2FVciUbwrCUZQPUKiREBh5LmVa5AiUqNLAkondo",
    },
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

