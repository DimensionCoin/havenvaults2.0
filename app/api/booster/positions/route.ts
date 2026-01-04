// app/api/booster/positions/route.ts
import { NextResponse } from "next/server";
import { Connection, PublicKey } from "@solana/web3.js";
import { BN } from "@coral-xyz/anchor";

import {
  JUPITER_PERPETUALS_PROGRAM_ID,
  JLP_POOL_ACCOUNT_PUBKEY,
  CUSTODY_PUBKEY,
} from "@/types/constants";

export const runtime = "nodejs";

const RPC = new Connection(
  process.env.NEXT_PUBLIC_SOLANA_RPC || "https://api.mainnet-beta.solana.com",
  "confirmed"
);

type PerpSide = "long" | "short";

// ✅ Fix: avoid `{}` type (eslint no-empty-object-type)
// Anchor enum variants usually decode into "empty objects"
type EmptyObj = Record<string, never>;
type PerpsSideDecoded = { long?: EmptyObj; short?: EmptyObj; none?: EmptyObj };

function generatePositionPda(args: {
  custody: PublicKey;
  collateralCustody: PublicKey;
  walletAddress: PublicKey;
  side: PerpSide;
}) {
  const sideSeed = args.side === "long" ? Buffer.from([1]) : Buffer.from([2]);

  const [position] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("position"),
      args.walletAddress.toBuffer(),
      JLP_POOL_ACCOUNT_PUBKEY.toBuffer(),
      args.custody.toBuffer(),
      args.collateralCustody.toBuffer(),
      sideSeed,
    ],
    JUPITER_PERPETUALS_PROGRAM_ID
  );

  return position;
}

/**
 * Layout:
 * discriminator [0..8)
 * owner [8..40)
 * pool [40..72)
 * custody [72..104)
 * collateralCustody [104..136)
 * openTime i64 [136..144)
 * updateTime i64 [144..152)
 * side u8 [152..153)
 * price u64 [153..161)
 * sizeUsd u64 [161..169)
 * collateralUsd u64 [169..177)
 * ... (rest ignored)
 */
function decodePositionAccount(data: Buffer): {
  owner: PublicKey;
  custody: PublicKey;
  collateralCustody: PublicKey;
  openTime: BN; // i64
  side: PerpsSideDecoded;
  price: BN; // u64
  sizeUsd: BN; // u64
  collateralUsd: BN; // u64
} {
  if (data.length < 210) throw new Error(`Position too small: ${data.length}`);

  let o = 0;
  o += 8; // discriminator

  const owner = new PublicKey(data.subarray(o, o + 32));
  o += 32;

  o += 32; // pool
  const custody = new PublicKey(data.subarray(o, o + 32));
  o += 32;

  const collateralCustody = new PublicKey(data.subarray(o, o + 32));
  o += 32;

  const openTime = new BN(data.subarray(o, o + 8), "le"); // i64
  o += 8;

  o += 8; // updateTime

  const sideByte = data.readUInt8(o);
  o += 1;

  let side: PerpsSideDecoded = {};
  if (sideByte === 1) side = { long: {} as EmptyObj };
  else if (sideByte === 2) side = { short: {} as EmptyObj };
  else side = { none: {} as EmptyObj };

  const price = new BN(data.subarray(o, o + 8), "le");
  o += 8;

  const sizeUsd = new BN(data.subarray(o, o + 8), "le");
  o += 8;

  const collateralUsd = new BN(data.subarray(o, o + 8), "le");
  o += 8;

  return {
    owner,
    custody,
    collateralCustody,
    openTime,
    side,
    price,
    sizeUsd,
    collateralUsd,
  };
}

export async function POST(req: Request) {
  try {
    const { ownerBase58 } = (await req.json()) as { ownerBase58?: string };
    if (!ownerBase58) {
      return NextResponse.json(
        { error: "ownerBase58 is required" },
        { status: 400 }
      );
    }

    const ownerPk = new PublicKey(ownerBase58);

    const SOL_CUSTODY = new PublicKey(CUSTODY_PUBKEY.SOL);
    const ETH_CUSTODY = new PublicKey(CUSTODY_PUBKEY.ETH);
    const BTC_CUSTODY = new PublicKey(CUSTODY_PUBKEY.BTC);
    const USDC_CUSTODY = new PublicKey(CUSTODY_PUBKEY.USDC);
    const USDT_CUSTODY = new PublicKey(CUSTODY_PUBKEY.USDT);

    const combos: Array<{
      symbol: "SOL" | "ETH" | "BTC";
      side: PerpSide;
      custody: PublicKey;
      collateralCustody: PublicKey;
    }> = [
      // Longs (self-collateral)
      {
        symbol: "SOL",
        side: "long",
        custody: SOL_CUSTODY,
        collateralCustody: SOL_CUSTODY,
      },
      {
        symbol: "ETH",
        side: "long",
        custody: ETH_CUSTODY,
        collateralCustody: ETH_CUSTODY,
      },
      {
        symbol: "BTC",
        side: "long",
        custody: BTC_CUSTODY,
        collateralCustody: BTC_CUSTODY,
      },

      // Shorts (USDC collateral)
      {
        symbol: "SOL",
        side: "short",
        custody: SOL_CUSTODY,
        collateralCustody: USDC_CUSTODY,
      },
      {
        symbol: "ETH",
        side: "short",
        custody: ETH_CUSTODY,
        collateralCustody: USDC_CUSTODY,
      },
      {
        symbol: "BTC",
        side: "short",
        custody: BTC_CUSTODY,
        collateralCustody: USDC_CUSTODY,
      },

      // Shorts (USDT collateral) optional
      {
        symbol: "SOL",
        side: "short",
        custody: SOL_CUSTODY,
        collateralCustody: USDT_CUSTODY,
      },
      {
        symbol: "ETH",
        side: "short",
        custody: ETH_CUSTODY,
        collateralCustody: USDT_CUSTODY,
      },
      {
        symbol: "BTC",
        side: "short",
        custody: BTC_CUSTODY,
        collateralCustody: USDT_CUSTODY,
      },
    ];

    const pdaList = combos.map((c) =>
      generatePositionPda({
        custody: c.custody,
        collateralCustody: c.collateralCustody,
        walletAddress: ownerPk,
        side: c.side,
      })
    );

    const infos = await RPC.getMultipleAccountsInfo(pdaList, "confirmed");
    const zero = new BN(0);

    const positions = infos
      .map((info, idx) => {
        if (!info?.data) return null;

        try {
          const decoded = decodePositionAccount(info.data);

          if (!decoded.sizeUsd.gt(zero)) return null;
          if (decoded.owner.toBase58() !== ownerPk.toBase58()) return null;

          const combo = combos[idx];

          return {
            publicKey: pdaList[idx].toBase58(),
            symbol: combo.symbol,
            side: combo.side,
            account: {
              owner: decoded.owner.toBase58(),
              custody: decoded.custody.toBase58(),
              collateralCustody: decoded.collateralCustody.toBase58(),
              openTime: decoded.openTime.toString(),
              price: decoded.price.toString(),
              sizeUsd: decoded.sizeUsd.toString(),
              collateralUsd: decoded.collateralUsd.toString(),
              side: decoded.side,
            },
          };
        } catch (e) {
          console.error("[/api/booster/positions] decode error", e);
          return null;
        }
      })
      .filter((x): x is NonNullable<typeof x> => !!x);

    return NextResponse.json({ positions }, { status: 200 });
  } catch (e) {
    console.error("[/api/booster/positions] error", e);
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      { error: msg || "Failed to fetch positions" },
      { status: 500 }
    );
  }
}
