import { NextResponse } from "next/server";

const JUPUSD_MINT = "JuprjznTrTSp2UFa3ZBUFgwdAmtZCq4MQCwysN55USD";
const JUP_API_BASE = "https://api.jup.ag/lend/v1/earn";

interface JupiterVaultAsset {
  address: string;
  chainId: string;
  name: string;
  symbol: string;
  decimals: number;
  logoUrl: string;
  price: string;
  coingeckoId: string;
}

interface JupiterVault {
  id: number;
  address: string;
  name: string;
  symbol: string;
  decimals: number;
  assetAddress: string;
  asset: JupiterVaultAsset;
  totalAssets: string;
  totalSupply: string;
  convertToShares: string;
  convertToAssets: string;
  rewardsRate: string;
  supplyRate: string;
  totalRate: string;
  rebalanceDifference: string;
  liquiditySupplyData: {
    modeWithInterest: boolean;
    supply: string;
    withdrawalLimit: string;
    lastUpdateTimestamp: string;
    expandPercent: number;
    expandDuration: string;
    baseWithdrawalLimit: string;
    withdrawableUntilLimit: string;
    withdrawable: string;
  };
  rewards: unknown[];
}

export async function GET() {
  try {
    const apiKey = process.env.JUP_API_KEY;

    if (!apiKey) {
      return NextResponse.json(
        { error: "JUP_API_KEY not configured" },
        { status: 500 }
      );
    }

    // Fetch all lending tokens/vaults from Jupiter
    const response = await fetch(`${JUP_API_BASE}/tokens`, {
      headers: {
        "x-api-key": apiKey,
      },
    });

    if (!response.ok) {
      throw new Error(
        `Jupiter API error: ${response.status} ${response.statusText}`
      );
    }

    const vaults = (await response.json()) as JupiterVault[];

    // Find JupUSD vault by assetAddress (not mint)
    const jupusdVault = vaults.find(
      (vault) =>
        vault.assetAddress === JUPUSD_MINT || vault.symbol === "jlJupUSD"
    );

    if (!jupusdVault) {
      return NextResponse.json(
        {
          error: "JUPUSD vault not found",
          availableVaults: vaults.map((v) => ({
            symbol: v.symbol,
            assetSymbol: v.asset?.symbol,
            assetAddress: v.assetAddress,
          })),
        },
        { status: 404 }
      );
    }

    // Calculate APY from rates (rates are in basis points per year / 10000)
    // totalRate includes both supply rate and rewards rate
    const apyDecimal = parseFloat(jupusdVault.totalRate) / 10000;

    // Return the APY and additional vault info
    return NextResponse.json({
      apy: apyDecimal, // Decimal (e.g., 0.0587 = 5.87%)
      apyPercentage: (apyDecimal * 100).toFixed(2), // Pre-formatted percentage "5.87"
      mint: jupusdVault.assetAddress,
      vaultAddress: jupusdVault.address,
      symbol: jupusdVault.asset?.symbol || "JupUSD",
      name: jupusdVault.asset?.name || "Jupiter USD",
      totalSupply: jupusdVault.totalSupply,
      totalAssets: jupusdVault.totalAssets,
      supplyRate: parseFloat(jupusdVault.supplyRate) / 10000, // Supply APY component
      rewardsRate: parseFloat(jupusdVault.rewardsRate) / 10000, // Rewards APY component
      totalRate: parseFloat(jupusdVault.totalRate) / 10000, // Combined APY
    });
  } catch (error) {
    console.error("Error fetching JUPUSD APY:", error);
    return NextResponse.json(
      {
        error: "Failed to fetch APY",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
