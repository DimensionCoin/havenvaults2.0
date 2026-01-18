// app/api/savings/plus/activity/route.ts
import { NextRequest, NextResponse } from "next/server";

const HELIUS_API_KEY = process.env.HELIUS_API_KEY!;
const JUPUSD_MINT = process.env.NEXT_PUBLIC_JUPUSD_MINT!;
const USDC_MINT = process.env.NEXT_PUBLIC_USDC_MINT!;
const PLUS_SAVINGS_VAULT_ADDR = process.env.PLUS_SAVINGS_VAULT_ADDR!;

// Jupiter Lend / Fluid program IDs
const JUP_LEND_PROGRAM_IDS = {
  liquidity: "jupeiUmn818Jg1ekPURTpr4mFo29p46vygyykFJ3wZC",
  lending: "jup3YeL8QhtSx1e253b2FDvsMNC87fDrgQZivbrndc9",
  rewardRateModel: "jup7TthsMgcR9Y3L277b8Eo9uboVSmu1utkuXHNUKar",
  vaults: "jupr81YtYssSyPt8jbnGuiWon5f6x9TcDEFxYe3Bdzi",
  oracle: "jupnw4B6Eqs7ft6rxpzYLJZYSnrpRgPcr589n5Kv4oc",
  flashloan: "jupgfSgfuAXv4B6R2Uxu85Z1qdzgju79s6MfZekN6XS",
};

const ALL_JUP_LEND_PROGRAMS = Object.values(JUP_LEND_PROGRAM_IDS);

// Helius API types
interface HeliusSignature {
  signature: string;
  slot: number;
  blockTime: number | null;
  err: unknown | null;
}

interface HeliusTokenTransfer {
  mint: string;
  tokenAmount: number;
  fromUserAccount: string;
  toUserAccount: string;
}

interface HeliusAccountData {
  account: string;
  nativeBalanceChange: number;
  tokenBalanceChanges: unknown[];
}

interface HeliusInstruction {
  programId: string;
  data: string;
  accounts: string[];
  innerInstructions?: HeliusInstruction[];
}

interface HeliusInnerInstructionGroup {
  instructions: HeliusInstruction[];
}

interface HeliusParsedTransaction {
  signature: string;
  timestamp: number;
  slot: number;
  fee: number;
  transactionError: unknown | null;
  description?: string;
  tokenTransfers?: HeliusTokenTransfer[];
  accountData?: HeliusAccountData[];
  instructions?: HeliusInstruction[];
  innerInstructions?: HeliusInnerInstructionGroup[];
}

interface HeliusRpcResponse<T> {
  jsonrpc: string;
  id: number;
  result?: T;
  error?: {
    code: number;
    message: string;
  };
}

type PlusActivityType = "deposit" | "withdraw" | "rebalance" | "unknown";

interface PlusActivityTransaction {
  signature: string;
  timestamp: number;
  type: PlusActivityType;
  usdcAmount: number | null;
  jupusdAmount: number | null;
  status: "success" | "failed";
  slot: number;
  fee: number;
  programId: string | null;
  tokenTransfers?: HeliusTokenTransfer[];
  accountData?: HeliusAccountData[];
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const walletAddress = searchParams.get("wallet");
    const limit = parseInt(searchParams.get("limit") || "25");
    const before = searchParams.get("before");

    if (!walletAddress) {
      return NextResponse.json(
        { ok: false, error: "Wallet address required" },
        { status: 400 },
      );
    }

    if (!HELIUS_API_KEY) {
      return NextResponse.json(
        { ok: false, error: "HELIUS_API_KEY not configured" },
        { status: 500 },
      );
    }

    const result = await fetchPlusActivityTransactions(
      walletAddress,
      limit,
      before,
    );

    return NextResponse.json({
      ok: true,
      vault: PLUS_SAVINGS_VAULT_ADDR,
      txs: result.transactions,
      nextBefore: result.nextBefore,
      exhausted: result.exhausted,
    });
  } catch (error) {
    console.error("Error fetching Plus Account activity:", error);
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to fetch transactions",
      },
      { status: 500 },
    );
  }
}

interface FetchResult {
  transactions: PlusActivityTransaction[];
  nextBefore: string | null;
  exhausted: boolean;
}

async function fetchPlusActivityTransactions(
  walletAddress: string,
  limit: number,
  before?: string | null,
): Promise<FetchResult> {
  // Helius /v0/transactions has a max of 100 transactions
  const sigFetchLimit = Math.min(limit * 4, 100);

  // Get signatures for the wallet
  const sigResponse = await fetch(
    `https://mainnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "getSignaturesForAddress",
        params: [
          walletAddress,
          {
            limit: sigFetchLimit,
            ...(before && { before }),
          },
        ],
      }),
    },
  );

  const sigResult = (await sigResponse.json()) as HeliusRpcResponse<
    HeliusSignature[]
  >;

  // Handle RPC errors
  if (sigResult.error) {
    console.error("Helius RPC error:", sigResult.error);
    throw new Error(sigResult.error.message || "Failed to fetch signatures");
  }

  const signatures = sigResult.result || [];

  if (signatures.length === 0) {
    return { transactions: [], nextBefore: null, exhausted: true };
  }

  // Fetch parsed transactions using Helius enhanced API
  const txResponse = await fetch(
    `https://api.helius.xyz/v0/transactions?api-key=${HELIUS_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        transactions: signatures.map((s) => s.signature),
      }),
    },
  );

  // Check response status
  if (!txResponse.ok) {
    const errorText = await txResponse.text();
    console.error("Helius API error:", txResponse.status, errorText);
    throw new Error(`Helius API error: ${txResponse.status}`);
  }

  const parsedTxsRaw: unknown = await txResponse.json();

  // Handle various response formats from Helius
  let parsedTxs: HeliusParsedTransaction[];
  if (Array.isArray(parsedTxsRaw)) {
    parsedTxs = parsedTxsRaw as HeliusParsedTransaction[];
  } else if (
    typeof parsedTxsRaw === "object" &&
    parsedTxsRaw !== null &&
    "result" in parsedTxsRaw &&
    Array.isArray((parsedTxsRaw as { result: unknown }).result)
  ) {
    parsedTxs = (parsedTxsRaw as { result: HeliusParsedTransaction[] }).result;
  } else if (
    typeof parsedTxsRaw === "object" &&
    parsedTxsRaw !== null &&
    "error" in parsedTxsRaw
  ) {
    const errorObj = parsedTxsRaw as { error: { message?: string } };
    console.error("Helius transactions API error:", errorObj.error);
    throw new Error(errorObj.error.message || "Failed to fetch transactions");
  } else {
    console.error(
      "Unexpected Helius response format:",
      typeof parsedTxsRaw,
      JSON.stringify(parsedTxsRaw).slice(0, 500),
    );
    parsedTxs = [];
  }

  const plusTxs: PlusActivityTransaction[] = [];
  let lastSigChecked: string | null = null;

  for (const tx of parsedTxs) {
    lastSigChecked = tx?.signature || lastSigChecked;
    if (!tx) continue;

    // Check if transaction involves Jupiter Lend programs
    const accountKeys: string[] = tx.accountData?.map((a) => a.account) || [];
    const instructions = tx.instructions || [];
    const innerInstructions = tx.innerInstructions || [];

    // Get all program IDs from instructions
    const programIds = new Set<string>();
    instructions.forEach((ix) => {
      if (ix.programId) programIds.add(ix.programId);
    });
    innerInstructions.forEach((inner) => {
      inner.instructions?.forEach((ix) => {
        if (ix.programId) programIds.add(ix.programId);
      });
    });

    // Check if any Jupiter Lend program is involved
    const involvedJupLendProgram = ALL_JUP_LEND_PROGRAMS.find(
      (pid) => programIds.has(pid) || accountKeys.includes(pid),
    );

    // Also check if the Plus savings vault is involved
    const involvesVault = accountKeys.includes(PLUS_SAVINGS_VAULT_ADDR);

    if (!involvedJupLendProgram && !involvesVault) continue;

    // Parse the transaction
    const parsed = parseJupLendTransaction(tx, walletAddress);

    plusTxs.push({
      signature: tx.signature,
      timestamp: tx.timestamp,
      type: parsed.type,
      usdcAmount: parsed.usdcAmount,
      jupusdAmount: parsed.jupusdAmount,
      status: tx.transactionError ? "failed" : "success",
      slot: tx.slot,
      fee: (tx.fee || 0) / 1e9,
      programId: involvedJupLendProgram || null,
      tokenTransfers: tx.tokenTransfers,
      accountData: tx.accountData,
    });

    if (plusTxs.length >= limit) break;
  }

  const maxSigFetch = Math.min(limit * 4, 100);
  const exhausted = signatures.length < maxSigFetch && plusTxs.length < limit;
  const nextBefore =
    plusTxs.length > 0 ? plusTxs[plusTxs.length - 1].signature : lastSigChecked;

  return {
    transactions: plusTxs,
    nextBefore: exhausted ? null : nextBefore,
    exhausted,
  };
}

interface ParsedTransaction {
  type: PlusActivityType;
  usdcAmount: number | null;
  jupusdAmount: number | null;
}

function parseJupLendTransaction(
  tx: HeliusParsedTransaction,
  walletAddress: string,
): ParsedTransaction {
  const tokenTransfers = tx.tokenTransfers || [];

  let usdcIn = 0;
  let usdcOut = 0;
  let jupusdIn = 0;
  let jupusdOut = 0;

  for (const transfer of tokenTransfers) {
    const amount = transfer.tokenAmount || 0;

    if (transfer.mint === USDC_MINT) {
      if (transfer.toUserAccount === walletAddress) {
        usdcIn += amount;
      } else if (transfer.fromUserAccount === walletAddress) {
        usdcOut += amount;
      }
    } else if (transfer.mint === JUPUSD_MINT) {
      if (transfer.toUserAccount === walletAddress) {
        jupusdIn += amount;
      } else if (transfer.fromUserAccount === walletAddress) {
        jupusdOut += amount;
      }
    }
  }

  let type: PlusActivityType = "unknown";

  if (usdcOut > 0.001 && jupusdIn > 0.001) {
    type = "deposit";
  } else if (jupusdOut > 0.001 && usdcIn > 0.001) {
    type = "withdraw";
  } else if (jupusdIn > 0.001 && usdcOut > 0.001) {
    type = "deposit";
  } else if (jupusdOut > 0.001) {
    type = "withdraw";
  } else if (
    Math.abs(usdcIn - usdcOut) < 0.001 &&
    Math.abs(jupusdIn - jupusdOut) < 0.001
  ) {
    const instructions = tx.instructions || [];
    const hasRebalanceInstruction = instructions.some(
      (ix) =>
        ix.programId === JUP_LEND_PROGRAM_IDS.lending &&
        (ix.data?.includes("rebalance") ||
          tx.description?.toLowerCase().includes("rebalance")),
    );
    if (hasRebalanceInstruction) {
      type = "rebalance";
    }
  }

  return {
    type,
    usdcAmount:
      type === "deposit"
        ? usdcOut > 0.001
          ? usdcOut
          : null
        : type === "withdraw"
          ? usdcIn > 0.001
            ? usdcIn
            : null
          : null,
    jupusdAmount:
      type === "deposit"
        ? jupusdIn > 0.001
          ? jupusdIn
          : null
        : type === "withdraw"
          ? jupusdOut > 0.001
            ? jupusdOut
            : null
          : null,
  };
}
