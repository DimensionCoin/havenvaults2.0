// app/(auth)/sign-in/page.tsx
"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  usePrivy,
  useLoginWithEmail,
  useLoginWithOAuth,
  User as PrivyUser,
} from "@privy-io/react-auth";
import { useCreateWallet as useCreateSolanaWallet } from "@privy-io/react-auth/solana";
import Image from "next/image";
import { FcGoogle } from "react-icons/fc";
import { IoMailSharp } from "react-icons/io5";
import { ChevronDown } from "lucide-react";

// ----------------- Page -----------------

export default function SignInPage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const { ready, authenticated, getAccessToken } = usePrivy();
  const { createWallet: createSolanaWallet } = useCreateSolanaWallet();

  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [uiError, setUiError] = useState<string | null>(null);

  const [bootstrapping, setBootstrapping] = useState(false);
  const [bootstrapError, setBootstrapError] = useState<string | null>(null);
  const bootstrappedRef = useRef(false);

  // Guard for wallet creation in StrictMode
  const walletCreationAttemptedRef = useRef(false);

  // 🔗 Referral code state (from URL)
  const initialReferralFromLink = searchParams.get("ref") || "";
  const [referralCode, setReferralCode] = useState(initialReferralFromLink);

  // 🔗 NEW: personal invite token from URL
  const inviteTokenFromLink = searchParams.get("invite") || "";

  // ✅ Referral dropdown UI state
  const [referralOpen, setReferralOpen] = useState(false);

  useEffect(() => {
    // keep referralCode in sync if the URL changes
    if (initialReferralFromLink) setReferralCode(initialReferralFromLink);

    // ✅ auto-open referral section if they arrived via referral or invite link
    if (initialReferralFromLink || inviteTokenFromLink) {
      setReferralOpen(true);
    }
  }, [initialReferralFromLink, inviteTokenFromLink]);

  /* ------------------------------------------------------------------ */
  /* 1) Ensure exactly one Solana wallet for this user                  */
  /* ------------------------------------------------------------------ */

  type PrivyLinkedAccount = {
    type?: string;
    chainType?: string;
    chain_type?: string;
    chain?: string;
    blockchain?: string;
    address?: string;
    publicAddress?: string;
    public_address?: string;
    wallet?: { address?: string | null };
    email?: string | null;
  };

  // ✅ minimal type for createWallet() return shape
  type CreatedWalletResult = {
    wallet: {
      address?: string | null;
      publicAddress?: string | null;
      public_address?: string | null;
    };
  };

  const ensureSolanaWallet = useCallback(
    async (user: PrivyUser | null): Promise<string | undefined> => {
      if (!user) return undefined;

      try {
        const linked: PrivyLinkedAccount[] = user.linkedAccounts ?? [];
        const existing = linked.find((acc) => {
          if (acc.type !== "wallet") return false;
          const chain =
            acc.chainType ||
            acc.chain_type ||
            acc.chain ||
            acc.blockchain ||
            "";
          const chainLower = String(chain).toLowerCase();
          return chainLower.includes("solana");
        });

        if (existing?.address && typeof existing.address === "string") {
          console.log("[ensureSolanaWallet] using existing", existing.address);
          return existing.address;
        }

        const nestedAddr =
          existing?.wallet?.address ||
          existing?.publicAddress ||
          existing?.public_address;

        if (nestedAddr && typeof nestedAddr === "string") {
          console.log(
            "[ensureSolanaWallet] using existing (nested)",
            nestedAddr
          );
          return nestedAddr;
        }
      } catch (e) {
        console.warn("[ensureSolanaWallet] inspect error:", e);
      }

      if (walletCreationAttemptedRef.current) {
        console.warn("[ensureSolanaWallet] creation already attempted");
        return undefined;
      }
      walletCreationAttemptedRef.current = true;

      try {
        const created = (await createSolanaWallet()) as CreatedWalletResult;

        const addr =
          created.wallet.address ||
          created.wallet.publicAddress ||
          created.wallet.public_address ||
          undefined;

        if (!addr || typeof addr !== "string") {
          console.warn(
            "[ensureSolanaWallet] wallet created but address missing",
            created
          );
          return undefined;
        }

        console.log("[ensureSolanaWallet] created wallet", addr);
        return addr;
      } catch (err) {
        console.error("[ensureSolanaWallet] createSolanaWallet error:", err);
        return undefined;
      }
    },
    [createSolanaWallet]
  );

  /* ------------------------------------------------------------------ */
  /* 2) Bootstrap: Privy ➜ /api/auth/session ➜ /api/auth/user          */
  /* ------------------------------------------------------------------ */

  const bootstrapWithPrivy = useCallback(
    async (opts?: {
      solanaAddress?: string;
      emailHint?: string;
      referralCode?: string;
      inviteToken?: string;
    }) => {
      if (bootstrappedRef.current) return;
      bootstrappedRef.current = true;

      setBootstrapping(true);
      setBootstrapError(null);

      try {
        const token = await getAccessToken();
        if (!token) throw new Error("No Privy access token");

        console.log("[bootstrapWithPrivy] sending session payload:", {
          solanaAddress: opts?.solanaAddress,
          emailHint: opts?.emailHint,
          referralCode: opts?.referralCode,
          inviteToken: opts?.inviteToken,
        });

        const sessionRes = await fetch("/api/auth/session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            accessToken: token,
            solanaAddress: opts?.solanaAddress,
            email: opts?.emailHint,
          }),
        });

        const sessionData: {
          user?: { isOnboarded?: boolean };
          isNewUser?: boolean;
          error?: string;
        } = await sessionRes.json().catch(() => ({}));

        if (!sessionRes.ok) {
          const errMsg =
            typeof sessionData.error === "string"
              ? sessionData.error
              : "Failed to create app session";
          throw new Error(errMsg);
        }

        const { user: appUser, isNewUser } = sessionData as {
          user?: { isOnboarded?: boolean };
          isNewUser?: boolean;
        };

        let finalUser = appUser;

        if (!finalUser) {
          const meRes = await fetch("/api/auth/user", {
            method: "GET",
            credentials: "include",
            cache: "no-store",
          });

          if (meRes.status === 401)
            throw new Error("Not authenticated after creating session.");
          if (meRes.status === 404) {
            router.replace("/onboard");
            return;
          }
          if (!meRes.ok) throw new Error("Failed to load user profile.");

          const { user } = (await meRes.json()) as {
            user: { isOnboarded?: boolean };
          };
          finalUser = user;
        }

        const isOnboarded = !!finalUser?.isOnboarded;

        // 🔗 Claim invite/referral for new users
        if (isNewUser) {
          const trimmedInvite = opts?.inviteToken?.trim();
          const trimmedCode = opts?.referralCode?.trim();
          let personalInviteLinked = false;

          if (trimmedInvite) {
            try {
              const claimInviteRes = await fetch("/api/user/invite/claim", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                credentials: "include",
                body: JSON.stringify({
                  inviteToken: trimmedInvite,
                  referralCode: trimmedCode || undefined,
                }),
              });

              const inviteData: { reason?: string; error?: string } =
                await claimInviteRes.json().catch(() => ({}));

              if (claimInviteRes.ok) {
                personalInviteLinked = true;
                console.log(
                  "[bootstrapWithPrivy] personal invite claim success:",
                  inviteData
                );
              } else {
                console.warn(
                  "[bootstrapWithPrivy] personal invite claim failure:",
                  claimInviteRes.status,
                  inviteData?.reason,
                  inviteData?.error
                );
              }
            } catch (err) {
              console.error(
                "[bootstrapWithPrivy] personal invite claim exception:",
                err
              );
            }
          }

          if (!personalInviteLinked && trimmedCode) {
            try {
              const claimRes = await fetch("/api/user/referral/claim", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                credentials: "include",
                body: JSON.stringify({ referralCode: trimmedCode }),
              });

              const claimData: { error?: string } = await claimRes
                .json()
                .catch(() => ({}));

              if (!claimRes.ok && claimRes.status !== 404) {
                console.error(
                  "[bootstrapWithPrivy] referral claim error:",
                  claimData?.error || claimRes.status
                );
              } else {
                console.log(
                  "[bootstrapWithPrivy] referral claim result:",
                  claimData
                );
              }
            } catch (err) {
              console.error(
                "[bootstrapWithPrivy] referral claim exception:",
                err
              );
            }
          }
        }

        if (!finalUser || isNewUser || !isOnboarded) router.replace("/onboard");
        else router.replace("/dashboard");
      } catch (err) {
        console.error("Bootstrap error:", err);
        const msg =
          err instanceof Error
            ? err.message
            : "Something went wrong while signing you in.";
        setBootstrapError(msg);
        bootstrappedRef.current = false;
        setBootstrapping(false);
      }
    },
    [getAccessToken, router]
  );

  /* ------------------------------------------------------------------ */
  /* 3) DO NOT auto-bootstrap authenticated users here                  */
  /* ------------------------------------------------------------------ */

  useEffect(() => {
    if (!ready) return;
    // No auto-bootstrap: we let the onComplete handlers drive it.
  }, [ready, authenticated]);

  /* ------------------------------------------------------------------ */
  /* 4) Privy login hooks                                               */
  /* ------------------------------------------------------------------ */

  const {
    sendCode,
    loginWithCode,
    state: emailState,
  } = useLoginWithEmail({
    onComplete: async ({ user }) => {
      try {
        setUiError(null);
        walletCreationAttemptedRef.current = false;

        const solAddr = await ensureSolanaWallet(user);
        const emailHint =
          user.email?.address ??
          (user as { email?: string | null })?.email ??
          undefined;

        await bootstrapWithPrivy({
          solanaAddress: solAddr,
          emailHint,
          referralCode: referralCode || undefined,
          inviteToken: inviteTokenFromLink || undefined,
        });
      } catch (err) {
        console.error("Email onComplete error:", err);
        setUiError(
          err instanceof Error
            ? err.message
            : "Something went wrong after email login."
        );
      }
    },
    onError: (err) => {
      console.error("Email login error:", err);
      setUiError(
        typeof err === "string"
          ? err
          : "Something went wrong logging you in with email."
      );
    },
  });

  const { initOAuth, state: oauthState } = useLoginWithOAuth({
    onComplete: async ({ user }) => {
      try {
        setUiError(null);
        walletCreationAttemptedRef.current = false;

        const solAddr = await ensureSolanaWallet(user);
        const emailHint =
          user.email?.address ??
          (user as { email?: string | null })?.email ??
          undefined;

        await bootstrapWithPrivy({
          solanaAddress: solAddr,
          emailHint,
          referralCode: referralCode || undefined,
          inviteToken: inviteTokenFromLink || undefined,
        });
      } catch (err) {
        console.error("OAuth onComplete error:", err);
        setUiError(
          err instanceof Error
            ? err.message
            : "Something went wrong after Google login."
        );
      }
    },
    onError: (err) => {
      console.error("OAuth login error:", err);
      setUiError(
        typeof err === "string"
          ? err
          : "Something went wrong with Google login."
      );
    },
  });

  /* ------------------------------------------------------------------ */
  /* 5) UI handlers                                                     */
  /* ------------------------------------------------------------------ */

  const handleSendCode = async () => {
    try {
      setUiError(null);
      await sendCode({ email: email.trim() });
    } catch (err) {
      console.error("Error sending code:", err);
      setUiError(err instanceof Error ? err.message : "Failed to send code");
    }
  };

  const handleSubmitCode = async () => {
    try {
      setUiError(null);
      await loginWithCode({ code: code.trim() });
    } catch (err) {
      console.error("Error logging in with code:", err);
      setUiError(
        err instanceof Error ? err.message : "Failed to log in with code"
      );
    }
  };

  const handleGoogleLogin = async () => {
    try {
      setUiError(null);
      await initOAuth({ provider: "google" });
    } catch (err) {
      console.error("OAuth init error:", err);
      setUiError(
        err instanceof Error ? err.message : "Failed to start Google login"
      );
    }
  };

  /* ------------------------------------------------------------------ */
  /* 6) Loading screen                                                  */
  /* ------------------------------------------------------------------ */

  if (!ready || bootstrapping) {
    return (
      <main className="relative min-h-screen overflow-hidden text-foreground">
        <div className="pointer-events-none fixed inset-0">
          <div className="absolute -top-40 left-1/2 h-[520px] w-[520px] -translate-x-1/2 rounded-full bg-emerald-400/15 blur-3xl" />
          <div className="absolute bottom-[-200px] right-[-120px] h-[520px] w-[520px] rounded-fullblur-3xl" />
        </div>

        <div className="relative flex min-h-screen items-center justify-center">
          <div className="glass-panel-soft px-8 py-6">
            <div className="flex items-center gap-3">
              <div className="relative h-8 w-8">
                <Image
                  src="/logo.jpg"
                  alt="Haven"
                  fill
                  className="rounded-2xl object-contain"
                />
              </div>
              <p className="text-xs text-slate-200/80">
                {bootstrapping ? "Signing you in…" : "Preparing Haven…"}
              </p>
            </div>
          </div>
        </div>
      </main>
    );
  }

  const isEmailFlowLoading =
    emailState.status === "sending-code" ||
    emailState.status === "submitting-code";

  const isOAuthLoading = oauthState.status === "loading";

  const combinedError = bootstrapError || uiError;

  /* ------------------------------------------------------------------ */
  /* 7) Main UI (glass styling)                                         */
  /* ------------------------------------------------------------------ */

  return (
    <main className="relative min-h-screen overflow-hidden text-foreground">
      <div className="pointer-events-none fixed inset-0">
        <div className="absolute -top-52 left-1/2 h-[560px] w-[560px] -translate-x-1/2 rounded-full bg-emerald-400/14 blur-3xl" />
        <div className="absolute bottom-[-260px] right-[-140px] h-[560px] w-[560px] rounded-full bg-emerald-500/10 blur-3xl" />
        <div className="absolute inset-y-0 left-0 w-[40%] " />
      </div>

      <div className="relative mx-auto flex min-h-screen max-w-5xl flex-col px-4 py-8 sm:px-6 lg:px-8">
        <header className="mb-10 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="relative flex h-9 w-9 items-center justify-center rounded-2xl shadow-[0_0_0_1px_rgba(148,163,184,0.3)] backdrop-blur-xl">
              <Image
                src="/logo.jpg"
                alt="Haven"
                fill
                className="rounded-2xl object-contain"
              />
            </div>
            <div className="flex flex-col">
              <span className="text-[10px] font-semibold uppercase tracking-[0.26em] text-slate-300/70">
                Haven
              </span>
              <span className="text-[10px] text-slate-400/80">
                Finance reimagined.
              </span>
            </div>
          </div>

          <span className="rounded-full border border-white/10 px-3 py-1.5 text-[10px] uppercase tracking-[0.16em] text-slate-300/70 backdrop-blur-xl">
            Secure session
          </span>
        </header>

        <div className="flex flex-1 flex-col items-center justify-center gap-10 pb-10 lg:flex-row lg:items-stretch">
          <section className="flex w-full max-w-md justify-center">
            <div className="glass-panel w-full px-6 py-6 sm:px-7 sm:py-7">
              <div className="mb-4">
                <p className="text-xs font-medium uppercase tracking-[0.24em] text-slate-400/80">
                  Sign in
                </p>
                <h2 className="mt-2 text-lg font-semibold text-slate-50">
                  Choose how you want to continue.
                </h2>
              </div>

              {combinedError && (
                <div className="mb-4 rounded-2xl border border-red-500/40 bg-red-500/10 px-3 py-2 text-[11px] text-red-100">
                  {combinedError}
                </div>
              )}

              {/* Email */}
              <div className="space-y-3">
                <label className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.18em] text-slate-400/80">
                  <IoMailSharp className="h-3.5 w-3.5 text-slate-300/80" />
                  <span>Email</span>
                </label>
                <input
                  type="email"
                  placeholder="you@company.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="glass-input"
                />

                {emailState.status === "awaiting-code-input" ? (
                  <>
                    <label className="mt-3 block text-[11px] font-medium uppercase tracking-[0.18em] text-slate-400/80">
                      One-time code
                    </label>
                    <input
                      type="text"
                      inputMode="numeric"
                      placeholder="••••••"
                      value={code}
                      onChange={(e) => setCode(e.target.value)}
                      className="glass-input tracking-[0.28em]"
                    />

                    <button
                      onClick={handleSubmitCode}
                      disabled={isEmailFlowLoading}
                      className="haven-primary-btn mt-3"
                    >
                      {isEmailFlowLoading ? "Confirming…" : "Confirm & enter"}
                    </button>

                    <button
                      type="button"
                      onClick={handleSendCode}
                      disabled={!email.trim() || isEmailFlowLoading}
                      className="mt-2 text-[11px] text-slate-400/80 underline underline-offset-4 hover:text-slate-200"
                    >
                      Resend code
                    </button>
                  </>
                ) : (
                  <button
                    onClick={handleSendCode}
                    disabled={!email.trim() || isEmailFlowLoading}
                    className="haven-primary-btn"
                  >
                    {isEmailFlowLoading ? "Sending code…" : "Send magic link"}
                  </button>
                )}
              </div>

              {/* Divider */}
              <div className="my-6 flex items-center gap-3 text-[10px] text-slate-500">
                <div className="h-px flex-1 bg-slate-500/30" />
                <span className="tracking-[0.2em] uppercase">or</span>
                <div className="h-px flex-1 bg-slate-500/30" />
              </div>

              {/* Google */}
              <button
                onClick={handleGoogleLogin}
                disabled={isOAuthLoading}
                className="haven-secondary-btn"
              >
                {isOAuthLoading ? (
                  "Connecting to Google…"
                ) : (
                  <>
                    <FcGoogle className="h-6 w-6" />
                    <span>Continue with Google</span>
                  </>
                )}
              </button>

              <p className="mt-5 text-[10px] leading-relaxed text-slate-400/90">
                By continuing, you agree to Haven’s Terms and acknowledge our
                Privacy Policy. Haven is non-custodial; you remain in control of
                your assets at all times.
              </p>

              {/* ✅ Referral dropdown (tucked away at bottom) */}
              <div className="mt-5 border-t border-white/10 pt-4">
                <button
                  type="button"
                  onClick={() => setReferralOpen((v) => !v)}
                  className="
                    flex w-full items-center justify-between
                    rounded-2xl border border-white/10
                    bg-white/5 px-3 py-2
                    text-[11px] text-slate-200/90
                    hover:bg-white/7
                    transition
                  "
                >
                  <span className="flex items-center gap-2">
                    <span className="font-medium">Have a referral code?</span>
                    {(inviteTokenFromLink || initialReferralFromLink) && (
                      <span className="rounded-full bg-emerald-400/15 px-2 py-0.5 text-[10px] text-emerald-200">
                        Loaded from link
                      </span>
                    )}
                    {inviteTokenFromLink && (
                      <span className="rounded-full bg-emerald-400/15 px-2 py-0.5 text-[10px] text-emerald-200">
                        Personal invite
                      </span>
                    )}
                  </span>

                  <ChevronDown
                    className={`h-4 w-4 text-slate-300/80 transition ${
                      referralOpen ? "rotate-180" : ""
                    }`}
                  />
                </button>

                {referralOpen && (
                  <div className="mt-2 space-y-1.5">
                    <div className="flex items-center justify-between">
                      <label className="text-[11px] font-medium text-slate-400">
                        Referral code{" "}
                        <span className="text-[10px] text-slate-500">
                          (optional)
                        </span>
                      </label>

                      {inviteTokenFromLink ? (
                        <span className="text-[10px] text-emerald-300">
                          Personal invite link
                        </span>
                      ) : initialReferralFromLink ? (
                        <span className="text-[10px] text-emerald-300">
                          Loaded from link
                        </span>
                      ) : null}
                    </div>

                    <input
                      value={referralCode}
                      onChange={(e) => setReferralCode(e.target.value)}
                      placeholder="Enter referral code"
                      className="glass-input text-xs"
                    />

                    <p className="text-[10px] text-slate-500">
                      If you don’t have one, you can leave this blank.
                    </p>
                  </div>
                )}
              </div>
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
