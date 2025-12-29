// providers/SolProvider.tsx
"use client";

import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useUser } from "@/providers/UserProvider";
import { useBalance } from "@/providers/BalanceProvider";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { AlertTriangle } from "lucide-react";

import {
  Connection,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";

import {
  ACCOUNT_SIZE,
  NATIVE_MINT,
  createAssociatedTokenAccountInstruction,
  createSyncNativeInstruction,
  getAssociatedTokenAddress,
} from "@solana/spl-token";

// ✅ Privy Solana hooks (React)
import {
  useWallets,
  useSignTransaction,
  type ConnectedStandardSolanaWallet,
} from "@privy-io/react-auth/solana";

/* ------------------------------------------------------------------ */
/*                         Types & Context                            */
/* ------------------------------------------------------------------ */

type SolContextValue = {
  nativeSol: number; // raw native SOL balance (not WSOL)
  checking: boolean; // mirrors BalanceProvider.loading
  refresh: () => Promise<void>; // calls BalanceProvider.refresh
};

const SolContext = createContext<SolContextValue | undefined>(undefined);

export function useSol(): SolContextValue {
  const ctx = useContext(SolContext);
  if (!ctx) {
    throw new Error("useSol must be used within <SolProvider>");
  }
  return ctx;
}

type SolProviderProps = {
  children: ReactNode;
};

/* ------------------------------------------------------------------ */
/*                          Constants                                 */
/* ------------------------------------------------------------------ */

/**
 * When to show the nudge modal.
 */
const MIN_SOL_TO_NOTIFY = 0.004;

/**
 * Keep this much SOL unwrapped as a gas buffer
 * (same idea as Haven 1.0).
 */
const MIN_NATIVE_SOL_BUFFER = 0.0035;

/**
 * RPC endpoint – matches the rest of your app.
 */
const RPC =
  process.env.NEXT_PUBLIC_SOLANA_RPC || "https://api.devnet.solana.com";

/* ------------------------------------------------------------------ */
/*                        Provider component                          */
/* ------------------------------------------------------------------ */

const SolProvider: React.FC<SolProviderProps> = ({ children }) => {
  const { user } = useUser();
  const walletAddress = user?.walletAddress; // Haven 2.0 main Solana address

  const {
    nativeSol, // from BalanceProvider (raw native SOL)
    loading: balanceLoading,
    refresh: refreshBalances,
  } = useBalance();

  const { wallets } = useWallets();
  const { signTransaction } = useSignTransaction();

  const [showModal, setShowModal] = useState(false);
  const [dismissedForSession, setDismissedForSession] = useState(false);
  const [converting, setConverting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const connection = useMemo(() => new Connection(RPC, "confirmed"), []);

  /* ------------------------- Modal visibility ------------------------- */

  useEffect(() => {
    if (!walletAddress) {
      setShowModal(false);
      setDismissedForSession(false);
      return;
    }

    // Only show if user has some native SOL above the threshold
    if (!dismissedForSession && nativeSol > MIN_SOL_TO_NOTIFY) {
      setShowModal(true);
    } else {
      setShowModal(false);
    }
  }, [walletAddress, nativeSol, dismissedForSession]);

  /* ---------------------------- Wrap handler -------------------------- */

  const handleConvertClick = async () => {
    setErrorMsg(null);
    setConverting(true);

    try {
      if (!walletAddress) {
        throw new Error("We couldn’t find your Haven wallet address.");
      }

      if (!wallets || wallets.length === 0) {
        throw new Error("We couldn’t find a Solana wallet for this account.");
      }

      // Match the Privy Solana wallet to the user’s stored address
      const userWallet: ConnectedStandardSolanaWallet | undefined =
        wallets.find(
          (wallet: ConnectedStandardSolanaWallet) =>
            wallet.address?.toLowerCase() === walletAddress.toLowerCase()
        ) ?? wallets[0];

      if (!userWallet) {
        throw new Error("We couldn’t find your Haven wallet for this step.");
      }

      const owner = new PublicKey(walletAddress);

      // ✅ Fresh on-chain balance
      const lamports = await connection.getBalance(owner, "confirmed");
      const solUi = lamports / LAMPORTS_PER_SOL;
      console.log(
        "[SolProvider] on-chain SOL:",
        solUi,
        "(",
        lamports,
        "lamports)"
      );

      const minKeepLamports = Math.ceil(
        MIN_NATIVE_SOL_BUFFER * LAMPORTS_PER_SOL
      );

      if (lamports <= minKeepLamports) {
        throw new Error(
          "There isn’t quite enough SOL to move after keeping a tiny amount for network fees."
        );
      }

      // wSOL ATA (wrapped SOL account)
      const wsolAta = await getAssociatedTokenAddress(
        NATIVE_MINT,
        owner,
        false
      );
      const ataInfo = await connection.getAccountInfo(wsolAta, "confirmed");

      const ixs = [];
      let rentExemptLamports = 0;

      // Create ATA if needed
      if (!ataInfo) {
        rentExemptLamports = await connection.getMinimumBalanceForRentExemption(
          ACCOUNT_SIZE
        );

        if (lamports <= minKeepLamports + rentExemptLamports) {
          throw new Error(
            "There isn’t enough SOL to create a wrapped SOL account and still keep a small fee buffer."
          );
        }

        ixs.push(
          createAssociatedTokenAccountInstruction(
            owner,
            wsolAta,
            owner,
            NATIVE_MINT
          )
        );
      }

      // Max we can safely wrap right now
      const maxWrapLamports = lamports - minKeepLamports - rentExemptLamports;

      if (maxWrapLamports <= 0) {
        throw new Error(
          "Nothing to wrap – your SOL is at or below the small fee buffer we keep."
        );
      }

      // Strategy: wrap everything above the buffer
      const wrapLamports = maxWrapLamports;

      console.log(
        "[SolProvider] wrapLamports:",
        wrapLamports,
        "=>",
        wrapLamports / LAMPORTS_PER_SOL,
        "SOL"
      );

      // Transfer SOL into the wSOL ATA + sync
      ixs.push(
        SystemProgram.transfer({
          fromPubkey: owner,
          toPubkey: wsolAta,
          lamports: wrapLamports,
        }),
        createSyncNativeInstruction(wsolAta)
      );

      const { blockhash, lastValidBlockHeight } =
        await connection.getLatestBlockhash("processed");

      const msg = new TransactionMessage({
        payerKey: owner,
        recentBlockhash: blockhash,
        instructions: ixs,
      }).compileToV0Message();

      const tx = new VersionedTransaction(msg);

      // Serialize for Privy (Uint8Array)
      const serialized = tx.serialize();

      // ✅ Ask Privy to sign the raw bytes (no backend, no sponsor)
      const { signedTransaction } = await signTransaction({
        transaction: serialized,
        wallet: userWallet,
        options: {
          uiOptions: {
            // Hide Privy’s own wallet modal – matches your “smooth” UX
            showWalletUIs: false,
          },
        },
      });

      // ✅ Send it directly via RPC
      const sig = await connection.sendRawTransaction(signedTransaction, {
        skipPreflight: false,
        maxRetries: 3,
      });

      await connection.confirmTransaction(
        { signature: sig, blockhash, lastValidBlockHeight },
        "confirmed"
      );

      console.log("[SolProvider] Wrap SOL tx signature:", sig);

      // Success: hide modal and don’t show again this session
      setShowModal(false);
      setDismissedForSession(true);

      // Refresh balances so nativeSol → wSOL is reflected in UI
      await refreshBalances();
    } catch (err: unknown) {
      console.error("[SolProvider] wrap SOL error:", err);

      let msg =
        "Something went wrong while moving that balance. Please try again.";

      if (err instanceof Error) msg = err.message;
      else if (typeof err === "string") msg = err;

      setErrorMsg(msg);
    } finally {
      setConverting(false);
    }
  };

  const handleNotNow = () => {
    setShowModal(false);
    setDismissedForSession(true);
  };

  const formattedSol = nativeSol.toFixed(4);

  const ctxValue: SolContextValue = {
    nativeSol,
    checking: balanceLoading,
    refresh: refreshBalances,
  };

  return (
    <SolContext.Provider value={ctxValue}>
      {children}

      <Dialog open={showModal} onOpenChange={() => {}}>
        <DialogContent className="max-w-sm border border-white/10 bg-[#020617] text-white">
          <DialogHeader className="space-y-2">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-amber-500/20 text-amber-300">
                <AlertTriangle className="h-4 w-4" />
              </div>
              <DialogTitle className="text-sm font-semibold">
                Make all of your balance usable in Haven
              </DialogTitle>
            </div>
            <DialogDescription className="text-xs text-zinc-300">
              We found a small piece of your balance ({formattedSol} SOL) that
              isn&apos;t in a Haven-ready token yet.
            </DialogDescription>
          </DialogHeader>

          <div className="mt-2 space-y-2 text-xs text-zinc-300">
            <p>
              To keep things simple, Haven uses one standard version of each
              asset. Right now, part of your balance is sitting in a{" "}
              <span className="font-medium text-zinc-100">
                system-only version of SOL
              </span>{" "}
              that Haven can&apos;t fully use for investing, savings, or
              transfers.
            </p>
            <p>
              By moving it into the{" "}
              <span className="font-medium text-zinc-100">
                Haven-ready SOL token
              </span>
              , your money stays the same, but it shows up clearly in your
              portfolio and works with every Haven feature.
            </p>
            <p className="text-[11px] text-zinc-400">
              This doesn&apos;t change how much you own. It&apos;s like moving
              cash from a drawer into your main account so Haven can see and use
              it.
            </p>

            {errorMsg && (
              <p className="mt-1 text-[11px] text-red-400">{errorMsg}</p>
            )}
          </div>

          <footer className="mt-4 flex flex-col gap-2 sm:flex-row sm:justify-end">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="w-full sm:w-auto border-white/20 text-xs"
              onClick={handleNotNow}
              disabled={converting}
            >
              Not now
            </Button>
            <Button
              type="button"
              size="sm"
              className="w-full sm:w-auto bg-[rgb(182,255,62)] hover:bg-[rgb(182,255,62)]/90 text-black text-xs font-semibold shadow-[0_0_18px_rgba(190,242,100,0.6)] disabled:opacity-60 disabled:cursor-not-allowed"
              onClick={handleConvertClick}
              disabled={converting}
            >
              {converting ? "Converting…" : "Convert to Haven SOL"}
            </Button>
          </footer>
        </DialogContent>
      </Dialog>
    </SolContext.Provider>
  );
};

export default SolProvider;
