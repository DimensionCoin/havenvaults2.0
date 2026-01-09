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
import {
  ChevronDown,
  ShieldCheck,
  Sparkles,
  Lock,
  ArrowLeft,
  ArrowRight,
  BadgeCheck,
} from "lucide-react";

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
      <main className="relative min-h-screen overflow-hidden bg-background text-foreground">
        {/* background */}
        <div className="pointer-events-none fixed inset-0">
          <div className="absolute -top-48 left-1/2 h-[620px] w-[620px] -translate-x-1/2 rounded-full bg-primary/10 blur-3xl" />
          <div className="absolute bottom-[-260px] right-[-160px] h-[620px] w-[620px] rounded-full bg-primary/10 blur-3xl" />
          <div
            className="absolute inset-0 opacity-[0.04] dark:opacity-[0.035]"
            style={{
              backgroundImage:
                "linear-gradient(rgba(0,0,0,0.6) 1px, transparent 1px), linear-gradient(90deg, rgba(0,0,0,0.6) 1px, transparent 1px)",
              backgroundSize: "72px 72px",
            }}
          />
        </div>

        <div className="relative flex min-h-screen items-center justify-center px-6">
          <div className="haven-glass w-full max-w-sm px-6 py-5">
            <div className="flex items-center gap-3">
              <div className="relative h-10 w-10 overflow-hidden rounded-2xl border border-border bg-background">
                <Image
                  src="/logo.jpg"
                  alt="Haven"
                  fill
                  className="object-contain"
                />
              </div>

              <div className="flex flex-col">
                <span className="haven-kicker">Haven</span>
                <span className="text-[12px] text-muted-foreground">
                  {bootstrapping
                    ? "Signing you in…"
                    : "Preparing your session…"}
                </span>
              </div>
            </div>

            <div className="mt-4 h-1.5 w-full overflow-hidden rounded-full bg-border">
              <div className="h-full w-[55%] rounded-full bg-primary/70" />
            </div>

            <div className="mt-3 flex items-center justify-between text-[11px] text-muted-foreground">
              <span className="inline-flex items-center gap-1.5">
                <Lock className="h-3.5 w-3.5" />
                Secure login
              </span>
              <span className="inline-flex items-center gap-1.5">
                <ShieldCheck className="h-3.5 w-3.5" />
                Non-custodial
              </span>
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

  const awaitingCode = emailState.status === "awaiting-code-input";

  /* ------------------------------------------------------------------ */
  /* 7) Main UI (neo-bank redesign; functionality unchanged)            */
  /* ------------------------------------------------------------------ */

  return (
    <main className="relative min-h-screen overflow-hidden bg-background text-foreground">
      {/* ambient + grid */}
      <div className="pointer-events-none fixed inset-0">
        <div className="absolute -top-56 left-1/2 h-[760px] w-[760px] -translate-x-1/2 rounded-full bg-primary/10 blur-3xl" />
        <div className="absolute bottom-[-340px] right-[-220px] h-[760px] w-[760px] rounded-full bg-primary/10 blur-3xl" />
        <div
          className="absolute inset-0 opacity-[0.04] dark:opacity-[0.035]"
          style={{
            backgroundImage:
              "linear-gradient(rgba(0,0,0,0.55) 1px, transparent 1px), linear-gradient(90deg, rgba(0,0,0,0.55) 1px, transparent 1px)",
            backgroundSize: "84px 84px",
          }}
        />
      </div>

      <div className="relative mx-auto flex min-h-screen max-w-6xl flex-col px-5 py-6 sm:px-8">
        {/* Top bar */}
        <header className="flex items-center justify-between">
          <button
            type="button"
            onClick={() => router.push("/")}
            className="inline-flex items-center gap-2 rounded-full border border-border bg-card/70 px-3 py-2 text-[12px] text-muted-foreground backdrop-blur-xl transition hover:bg-secondary"
          >
            <ArrowLeft className="h-4 w-4" />
            Back
          </button>

          <div className="flex items-center gap-3">
            <div className="relative h-9 w-9 overflow-hidden rounded-2xl border border-border bg-card shadow-fintech-sm">
              <Image
                src="/logo.jpg"
                alt="Haven"
                fill
                className="object-contain"
              />
            </div>

            <div className="hidden sm:flex flex-col leading-tight">
              <span className="text-[12px] font-semibold tracking-tight">
                Haven
              </span>
              <span className="text-[11px] text-muted-foreground">
                Banking that works for you
              </span>
            </div>

            <span className="ml-2 hidden sm:inline-flex items-center gap-2 rounded-full border border-border bg-card/70 px-3 py-2 text-[11px] text-muted-foreground backdrop-blur-xl">
              <Lock className="h-3.5 w-3.5" />
              Secure sign-in
            </span>
          </div>
        </header>

        {/* Body */}
        <div className="mt-8 grid flex-1 items-center gap-10 lg:grid-cols-2 lg:gap-14">
          {/* Left: brand / trust (neo-bank) */}
          <section className="order-2 lg:order-1">
            <div className="max-w-xl">
              <div className="inline-flex items-center gap-2 rounded-full border border-border bg-card/70 px-3 py-2 text-[11px] text-muted-foreground shadow-fintech-sm backdrop-blur-xl">
                <Sparkles className="h-4 w-4 text-primary" />
                Non-custodial · Your keys, your money
              </div>

              <h1 className="mt-5 text-3xl sm:text-4xl lg:text-5xl font-semibold tracking-tight leading-[1.05]">
                Sign in to your <span className="text-primary">Haven</span>{" "}
                account
              </h1>

              <p className="mt-4 text-[15px] sm:text-base text-muted-foreground leading-relaxed">
                A neo-bank experience on Solana. Earn yield, invest instantly,
                and stay in full control — without crypto complexity.
              </p>

              <div className="mt-7 grid gap-3 sm:grid-cols-2">
                {[
                  {
                    icon: ShieldCheck,
                    title: "Secure by design",
                    desc: "We don’t custody funds. You control the keys.",
                  },
                  {
                    icon: BadgeCheck,
                    title: "Fast onboarding",
                    desc: "Email or Google. Wallet created automatically.",
                  },
                  {
                    icon: Lock,
                    title: "Private session",
                    desc: "HttpOnly app session after Privy verification.",
                  },
                  {
                    icon: Sparkles,
                    title: "Made for normal people",
                    desc: "Clean UI. Clear choices. No jargon.",
                  },
                ].map((item, i) => (
                  <div key={i} className="haven-card-soft p-4">
                    <div className="flex items-start gap-3">
                      <div className="inline-flex h-10 w-10 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                        <item.icon className="h-5 w-5" />
                      </div>
                      <div className="flex flex-col">
                        <span className="text-[13px] font-semibold">
                          {item.title}
                        </span>
                        <span className="mt-1 text-[12px] text-muted-foreground leading-snug">
                          {item.desc}
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {/* tiny “trust line” */}
              <div className="mt-6 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                <span className="inline-flex items-center gap-2 rounded-full border border-border bg-card/60 px-3 py-2">
                  <ShieldCheck className="h-3.5 w-3.5 text-primary" />
                  Built on Solana
                </span>
                <span className="inline-flex items-center gap-2 rounded-full border border-border bg-card/60 px-3 py-2">
                  <Lock className="h-3.5 w-3.5 text-primary" />
                  Encrypted sessions
                </span>
              </div>
            </div>
          </section>

          {/* Right: sign-in card */}
          <section className="order-1 lg:order-2 flex justify-center lg:justify-end">
            <div className="w-full max-w-md">
              <div className="haven-glass p-6 sm:p-7">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="haven-kicker">Welcome back</p>
                    <h2 className="mt-2 text-xl font-semibold tracking-tight">
                      Continue to Haven
                    </h2>
                    <p className="mt-2 text-[12px] text-muted-foreground leading-relaxed">
                      Use email or Google. We’ll create your Solana wallet if
                      you don’t have one yet.
                    </p>
                  </div>

                  <div className="shrink-0">
                    <span className="haven-pill haven-pill-positive">
                      <Lock className="h-3.5 w-3.5 text-primary" />
                      Secure
                    </span>
                  </div>
                </div>

                {/* Error */}
                {combinedError && (
                  <div className="mt-5 rounded-2xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-[12px] text-destructive">
                    {combinedError}
                  </div>
                )}

                {/* Google first (neo-bank pattern) */}
                <button
                  onClick={handleGoogleLogin}
                  disabled={isOAuthLoading}
                  className="mt-5 inline-flex w-full items-center justify-center gap-3 rounded-2xl border border-border bg-card px-4 py-3 text-sm font-semibold shadow-fintech-sm transition hover:bg-secondary disabled:opacity-60"
                >
                  <FcGoogle className="h-6 w-6" />
                  <span>
                    {isOAuthLoading ? "Connecting…" : "Continue with Google"}
                  </span>
                </button>

                {/* Divider */}
                <div className="my-6 flex items-center gap-3 text-[11px] text-muted-foreground">
                  <div className="h-px flex-1 bg-border" />
                  <span className="tracking-[0.2em] uppercase">or</span>
                  <div className="h-px flex-1 bg-border" />
                </div>

                {/* Email flow */}
                <div className="space-y-3">
                  <label className="text-[12px] font-semibold tracking-tight">
                    Email
                  </label>

                  <div className="relative">
                    <div className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                      <IoMailSharp className="h-4 w-4" />
                    </div>
                    <input
                      type="email"
                      placeholder="you@domain.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="haven-input pl-9"
                    />
                  </div>

                  {/* “state chip” */}
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] text-muted-foreground">
                      {awaitingCode
                        ? "Enter the one-time code we emailed you."
                        : "We’ll email you a one-time code."}
                    </span>

                    <span className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 text-[11px] text-muted-foreground">
                      <ShieldCheck className="h-3.5 w-3.5 text-primary" />
                      No passwords
                    </span>
                  </div>

                  {awaitingCode && (
                    <>
                      <label className="mt-2 text-[12px] font-semibold tracking-tight">
                        One-time code
                      </label>

                      <input
                        type="text"
                        inputMode="numeric"
                        placeholder="••••••"
                        value={code}
                        onChange={(e) => setCode(e.target.value)}
                        className="haven-input tracking-[0.35em] text-center"
                      />

                      <button
                        onClick={handleSubmitCode}
                        disabled={isEmailFlowLoading}
                        className="haven-btn-primary"
                      >
                        {isEmailFlowLoading ? (
                          "Confirming…"
                        ) : (
                          <>
                            Confirm & enter
                            <ArrowRight className="h-4 w-4" />
                          </>
                        )}
                      </button>

                      <button
                        type="button"
                        onClick={handleSendCode}
                        disabled={!email.trim() || isEmailFlowLoading}
                        className="haven-btn-secondary py-2.5"
                      >
                        Resend code
                      </button>
                    </>
                  )}

                  {!awaitingCode && (
                    <button
                      onClick={handleSendCode}
                      disabled={!email.trim() || isEmailFlowLoading}
                      className="haven-btn-primary"
                    >
                      {isEmailFlowLoading ? (
                        "Sending…"
                      ) : (
                        <>
                          Send one-time code
                          <ArrowRight className="h-4 w-4" />
                        </>
                      )}
                    </button>
                  )}
                </div>

                {/* Referral accordion */}
                <div className="mt-6 border-t border-border pt-4">
                  <button
                    type="button"
                    onClick={() => setReferralOpen((v) => !v)}
                    className="flex w-full items-center justify-between rounded-2xl border border-border bg-card px-4 py-3 text-[12px] font-semibold shadow-fintech-sm transition hover:bg-secondary"
                  >
                    <span className="flex items-center gap-2">
                      <span>Referral / invite</span>
                      {(inviteTokenFromLink || initialReferralFromLink) && (
                        <span className="rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
                          Loaded
                        </span>
                      )}
                      {inviteTokenFromLink && (
                        <span className="rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
                          Personal invite
                        </span>
                      )}
                    </span>

                    <ChevronDown
                      className={`h-4 w-4 text-muted-foreground transition ${
                        referralOpen ? "rotate-180" : ""
                      }`}
                    />
                  </button>

                  {referralOpen && (
                    <div className="mt-3 rounded-2xl border border-border bg-card p-4">
                      <div className="flex items-center justify-between">
                        <label className="text-[12px] font-semibold tracking-tight">
                          Referral code{" "}
                          <span className="text-[11px] font-normal text-muted-foreground">
                            (optional)
                          </span>
                        </label>

                        {inviteTokenFromLink ? (
                          <span className="text-[11px] text-primary">
                            Invite link detected
                          </span>
                        ) : initialReferralFromLink ? (
                          <span className="text-[11px] text-primary">
                            Auto-filled
                          </span>
                        ) : null}
                      </div>

                      <input
                        value={referralCode}
                        onChange={(e) => setReferralCode(e.target.value)}
                        placeholder="Enter referral code"
                        className="haven-input mt-2"
                      />

                      <p className="mt-2 text-[11px] text-muted-foreground">
                        No code? Leave it blank — you can still sign in.
                      </p>
                    </div>
                  )}
                </div>

                {/* Fine print */}
                <p className="mt-6 text-[11px] leading-relaxed text-muted-foreground">
                  By continuing, you agree to Haven’s Terms and acknowledge our
                  Privacy Policy. Haven is non-custodial software — you remain
                  in control of your assets at all times.
                </p>
              </div>

              {/* tiny footer */}
              <div className="mt-4 text-center text-[11px] text-muted-foreground">
                Haven Labs · Secured by Privy · Built on Solana
              </div>
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
