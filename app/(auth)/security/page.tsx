// app/security/page.tsx
"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";

const PRIVY_DOCS_WALLETS_OVERVIEW = "https://docs.privy.io/wallets/overview";
const PRIVY_DOCS_GLOBAL_WALLETS =
  "https://docs.privy.io/wallets/global-wallets/overview";

const JUP_MOBILE_SITE = "https://jup.ag/mobile";
const JUP_MOBILE_APPSTORE =
  "https://apps.apple.com/us/app/jupiter-mobile-solana-wallet/id6484069059";
const JUP_MOBILE_PLAYSTORE =
  "https://play.google.com/store/apps/details?id=ag.jup.jupiter.android";

function detectPlatform() {
  if (typeof navigator === "undefined") return "web" as const;
  const ua = navigator.userAgent || "";
  const isAndroid = /Android/i.test(ua);
  const isIOS = /iPhone|iPad|iPod/i.test(ua);
  if (isIOS) return "ios" as const;
  if (isAndroid) return "android" as const;
  return "web" as const;
}

const SecurityPage = () => {
  const [platform, setPlatform] = useState<"ios" | "android" | "web">("web");

  useEffect(() => {
    setPlatform(detectPlatform());
  }, []);

  const jupMobileHref = useMemo(() => {
    if (platform === "ios") return JUP_MOBILE_APPSTORE;
    if (platform === "android") return JUP_MOBILE_PLAYSTORE;
    return JUP_MOBILE_SITE;
  }, [platform]);

  const jupMobileLabel = useMemo(() => {
    if (platform === "ios") return "Open Jupiter Mobile on the App Store";
    if (platform === "android") return "Open Jupiter Mobile on Google Play";
    return "Open Jupiter Mobile website";
  }, [platform]);

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-3xl px-5 py-10 sm:px-8">
        {/* Header */}
        <div className="mb-8">
          <Link
            href="/"
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            ← Back to Haven
          </Link>

          <h1 className="mt-4 text-3xl font-bold tracking-tight">Security</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Last updated: {new Date().toLocaleDateString()}
          </p>
        </div>

        <section className="prose prose-invert max-w-none">
          <p>
            Haven is designed with security as a core product requirement. This
            page explains, in plain language, how account access and wallet
            functionality work, what we do (and do not) store, and how you can
            keep your account protected.
          </p>

          <hr />

          <h2>1. Authentication and account access</h2>
          <p>
            Haven uses Privy for authentication and embedded wallet
            functionality. Privy supports modern sign-in methods (such as email
            verification and social login), and is designed to reduce the
            security risks associated with passwords.
          </p>
          <ul>
            <li>
              <strong>No passwords stored by Haven:</strong> Haven does not
              store user passwords in our database.
            </li>
            <li>
              <strong>Protected sessions:</strong> After authentication, Haven
              uses protected session mechanisms to keep you signed in without
              exposing sensitive credentials to the client.
            </li>
          </ul>

          <p>
            Learn more about Privy’s wallet system here:{" "}
            <a
              href={PRIVY_DOCS_WALLETS_OVERVIEW}
              target="_blank"
              rel="noreferrer"
            >
              Privy Wallets Overview
            </a>
            .
          </p>

          <hr />

          <h2>2. Wallet management (embedded wallets)</h2>
          <p>
            Haven uses embedded wallets provided by Privy. An embedded wallet is
            a wallet created for you inside the Haven experience, so you can use
            the app without installing browser extensions or copying long
            addresses.
          </p>

          <p>
            Privy also supports “global wallets” (interoperable embedded
            wallets) that can be used across multiple applications depending on
            the configuration. More details are available here:{" "}
            <a
              href={PRIVY_DOCS_GLOBAL_WALLETS}
              target="_blank"
              rel="noreferrer"
            >
              Privy Global Wallets
            </a>
            .
          </p>

          <hr />

          <h2>3. Key export and portability</h2>
          <p>
            Haven is built so you can maintain control over your assets. Subject
            to the wallet configuration and features available in your account,
            you may be able to export your wallet’s private key or recovery
            material and import it into another compatible wallet application.
          </p>

          <p className="text-muted-foreground">
            <strong>Important:</strong> Exporting keys is a powerful action. If
            someone obtains your private key or recovery phrase, they can access
            your funds. Never share it, never paste it into unknown websites,
            and store it offline in a secure place.
          </p>

          <div className="not-prose mt-4 rounded-2xl border border-border bg-background/60 p-5">
            <div className="text-sm font-semibold">
              Use your Haven wallet elsewhere
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              If you choose to use your account in another wallet app, you can
              import your wallet into a third-party wallet such as Jupiter
              Mobile.
            </p>
            <a
              href={jupMobileHref}
              target="_blank"
              rel="noreferrer"
              className="mt-3 inline-flex w-fit items-center rounded-full bg-primary px-4 py-2 text-sm font-semibold text-black hover:bg-primary/90"
            >
              {jupMobileLabel}
            </a>
            <p className="mt-3 text-xs text-muted-foreground">
              This link is selected based on your device (iOS → App Store,
              Android → Google Play, otherwise the Jupiter website).
            </p>
          </div>

          <hr />

          <h2>4. What Haven stores (and what we don’t)</h2>
          <p>
            Haven is designed to minimize sensitive data storage. We store basic
            account profile details needed to operate the service (such as name,
            email, country, display currency, and your self-reported investing
            knowledge and risk tolerance), plus operational metadata (for
            example, timestamps and configuration flags).
          </p>
          <p>
            Haven does not store your password. We also do not store your
            private keys at all. Haven or Privy never have access to your privae key and only you can export it.
          </p>

          <hr />

          <h2>5. Transaction security and confirmations</h2>
          <p>
            Transactions can involve third-party services and public networks.
            When you take an action (like a swap or moving funds), you are
            authorizing a transaction that may be broadcast to a public network
            for settlement. Public transactions may be irreversible after
            confirmation.
          </p>

          <p>
            You are responsible for reviewing transaction details before you
            confirm, including the destination address, amounts, and any fees
            disclosed in-app.
          </p>

          <hr />

          <h2>6. Third-party and smart contract risks</h2>
          <p>
            Haven may integrate with third-party protocols and routing services
            (for example, for swapping or yield features). These systems can
            carry risks including smart contract vulnerabilities, oracle
            failures, liquidity constraints, network congestion, or unexpected
            protocol changes. These risks can result in delayed transactions or
            loss of funds.
          </p>
          <p>
            Haven cannot guarantee the security or availability of third-party
            protocols or public networks. You should only use features you
            understand and are comfortable with.
          </p>

          <hr />

          <h2>7. Account safety recommendations</h2>
          <ul>
            <li>Use a strong, unique email account and secure it with MFA.</li>
            <li>Do not share verification codes or recovery materials.</li>
            <li>Be cautious of phishing links and lookalike domains.</li>
            <li>
              If you export keys, store them securely offline and never in plain
              text notes or screenshots.
            </li>
            <li>Keep your device OS and browser up to date.</li>
          </ul>

          <hr />

          <h2>8. Reporting security issues</h2>
          <p>
            If you believe you’ve found a security vulnerability, please contact
            us at{" "}
            <a href="mailto:security@havenvaults.com">
              security@havenvaults.com
            </a>
            . Include as much detail as possible so we can investigate quickly.
            Please do not publicly disclose vulnerabilities before we’ve had an
            opportunity to address them.
          </p>

          <hr />

          <h2>9. Changes to this page</h2>
          <p>
            We may update this Security page to reflect improvements to our
            systems or changes in how features work. Updates will be posted here
            with a revised “Last updated” date.
          </p>
        </section>

        <div className="mt-10 rounded-2xl border border-border bg-background/60 p-5 text-xs text-muted-foreground">
          <p className="mb-0">
            This page is provided for transparency and is not a guarantee of
            security. All software involves risk. Use of third-party protocols
            and public networks may expose you to risks beyond Haven’s control.
          </p>
        </div>
      </div>
    </main>
  );
};

export default SecurityPage;
