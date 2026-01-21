// app/terms/page.tsx
import React from "react";
import Link from "next/link";

const Terms = () => {
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

          <h1 className="mt-4 text-3xl font-bold tracking-tight">
            Terms of Service
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Effective date: {new Date().toLocaleDateString()}
          </p>
        </div>

        <section className="prose prose-invert max-w-none">
          <p>
            These Terms of Service (“Terms”) govern your access to and use of
            Haven Vaults (“Haven”, “we”, “us”, “our”) websites, applications,
            and related services (collectively, the “Services”). By accessing or
            using the Services, you agree to these Terms.
          </p>

          <p>
            <strong>Important:</strong> Haven is non-custodial software. We do
            not take possession of your funds. You are responsible for your
            decisions, understanding how the Services work, and the risks
            described below.
          </p>

          <hr />

          <h2>1. Eligibility and account</h2>
          <p>
            You must be legally able to enter into these Terms and comply with
            applicable laws in your jurisdiction. You are responsible for
            maintaining the confidentiality of your login credentials and for
            all activity performed through your account.
          </p>

          <hr />

          <h2>2. Non-custodial nature of the Services</h2>
          <p>
            The Services are designed to help you interact with third-party
            financial and settlement rails, including public blockchain
            networks. You control your assets and authorize transactions. We do
            not control the underlying networks and cannot reverse, cancel, or
            modify transactions once broadcast or confirmed.
          </p>

          <hr />

          <h2>3. Third-party providers and integrations</h2>
          <p>
            The Services may integrate with or rely on third parties, including
            but not limited to: identity/authentication providers,
            fiat-to-digital asset onramp providers, liquidity venues,
            decentralized protocols, and RPC or infrastructure providers
            (collectively, “Third-Party Services”).
          </p>
          <p>
            Third-Party Services are not operated by Haven and may be governed
            by their own terms, policies, and processes. Haven is not
            responsible for Third-Party Services, including availability,
            pricing, delays, errors, or interruptions.
          </p>

          <hr />

          <h2>4. Fiat onramp and deposits (bank transfers and cards)</h2>
          <p>
            Haven may offer the ability to fund your account using a third-party
            onramp provider that converts fiat currency (for example, CAD or
            USD) into digital dollars (for example, USDC or similar stable-value
            tokens) and delivers them to your on-chain address.
          </p>

          <h3>4.1 Processing times, holds, and reversals</h3>
          <p>
            Bank transfers and card payments may be subject to processing
            delays, compliance reviews, account verification, settlement
            windows, and chargeback or reversal risk. As a result, deposits may
            be pending for a period of time and may be delayed or rejected by
            the onramp provider or your financial institution.
          </p>

          <h3>4.2 Support for onramp issues</h3>
          <p>
            If a deposit is delayed, pending, rejected, reversed, or otherwise
            not received, you may need to contact the onramp provider directly.
            Haven may provide links or guidance to help you reach the correct
            provider support channel, but Haven does not control the provider’s
            decision-making or timelines.
          </p>

          <h3>4.3 Fees</h3>
          <p>
            Onramp providers may charge fees (and your bank may charge fees).
            Any applicable fees should be disclosed to you before you confirm a
            deposit. Haven may also charge fees for certain Services as
            disclosed in-app.
          </p>

          <hr />

          <h2>5. Swaps and trading</h2>
          <p>
            The Services may enable token swaps or trades using third-party
            liquidity and routing providers, including Jupiter (“JUP”) or other
            aggregators. Quotes and execution outcomes can change quickly due to
            market conditions, liquidity, and network congestion.
          </p>

          <h3>5.1 Quotes are estimates</h3>
          <p>
            Any price, rate, or quote presented is an estimate and may differ at
            execution due to slippage, fees, routing changes, or market
            movement. You are responsible for reviewing and approving the final
            transaction details before confirming.
          </p>

          <h3>5.2 Transaction finality</h3>
          <p>
            Once you authorize and broadcast a swap transaction, it may not be
            possible to cancel or reverse it.
          </p>

          <hr />

          <h2>6. Savings, lending, and yield</h2>
          <p>
            Haven may provide features that allow you to allocate assets to
            lending and borrowing pools or other yield-generating mechanisms
            through third-party protocols (including via Jupiter’s lending and
            earning routes where available). Any displayed APY or yield rate may
            vary over time and is not guaranteed.
          </p>

          <h3>6.1 Source of yield</h3>
          <p>
            Yield generally comes from market-based activity, such as borrowers
            paying interest to lenders, incentive programs, or protocol-specific
            mechanisms. Rates can change frequently based on supply and demand,
            utilization, incentives, and other factors.
          </p>

          <h3>6.2 Risks of lending and smart contracts</h3>
          <p>
            Using lending pools and other decentralized protocols involves risk,
            including the risk of partial or total loss of funds. Risks may
            include, without limitation:
          </p>
          <ul>
            <li>
              Smart contract vulnerabilities, exploits, or unforeseen bugs
            </li>
            <li>Oracle failures or pricing inaccuracies</li>
            <li>Protocol governance changes or parameter changes</li>
            <li>Liquidity constraints, withdrawal limits, or delays</li>
            <li>Network congestion, downtime, or validator/RPC issues</li>
            <li>Stable-value token depegging or issuer-related events</li>
          </ul>
          <p>
            You acknowledge and agree that you assume all risks associated with
            interacting with these protocols and networks.
          </p>

          <hr />

          <h2>7. No financial advice</h2>
          <p>
            Haven does not provide investment, legal, tax, or accounting advice.
            Any information presented through the Services is for general
            informational purposes only. You should consult qualified
            professionals as appropriate.
          </p>

          <hr />

          <h2>8. Prohibited use</h2>
          <p>
            You agree not to misuse the Services, including by attempting to:
            (a) interfere with or disrupt the Services or networks; (b) bypass
            security controls; (c) use the Services for unlawful activity; or
            (d) infringe the rights of others.
          </p>

          <hr />

          <h2>9. Disclaimers</h2>
          <p>
            The Services are provided “as is” and “as available.” To the maximum
            extent permitted by law, Haven disclaims all warranties, express or
            implied, including warranties of merchantability, fitness for a
            particular purpose, and non-infringement.
          </p>
          <p>
            Haven does not warrant that the Services will be uninterrupted,
            secure, or error-free, or that Third-Party Services will be
            available or function as expected.
          </p>

          <hr />

          <h2>10. Limitation of liability</h2>
          <p>
            To the maximum extent permitted by law, Haven will not be liable for
            any indirect, incidental, special, consequential, or punitive
            damages, or any loss of profits, revenues, data, goodwill, or other
            intangible losses arising out of or relating to your use of the
            Services.
          </p>
          <p>
            To the maximum extent permitted by law, Haven’s total liability for
            any claim arising out of or relating to the Services will not exceed
            the amount of fees (if any) you paid to Haven for the Services in
            the 3 months preceding the event giving rise to the claim.
          </p>

          <hr />

          <h2>11. Indemnification</h2>
          <p>
            You agree to indemnify and hold harmless Haven and its affiliates,
            officers, directors, employees, and agents from and against any
            claims, liabilities, damages, losses, and expenses (including
            reasonable legal fees) arising out of or related to your use of the
            Services, your violation of these Terms, or your violation of any
            rights of another.
          </p>

          <hr />

          <h2>12. Changes to the Services and Terms</h2>
          <p>
            We may modify the Services and these Terms from time to time. If we
            make material changes, we will update the effective date above and
            post the updated Terms on this page. Your continued use of the
            Services after changes become effective constitutes acceptance of
            the updated Terms.
          </p>

          <hr />

          <h2>13. Termination</h2>
          <p>
            We may suspend or terminate access to the Services at any time if we
            reasonably believe you have violated these Terms, pose a security
            risk, or if required by law. You may stop using the Services at any
            time.
          </p>

          <hr />

          <h2>14. Governing law</h2>
          <p>
            These Terms are governed by the laws of the jurisdiction in which
            Haven is established, without regard to conflict of law principles.
            (If you want this to say “Ontario, Canada”, replace this sentence
            with your chosen governing law and venue language.)
          </p>

          <hr />

          <h2>15. Contact</h2>
          <p>
            If you have questions about these Terms, contact us at{" "}
            <a href="mailto:support@havenvaults.com">support@havenvaults.com</a>
            . (Update this email if needed.)
          </p>
        </section>

        <div className="mt-10 rounded-2xl border border-border bg-background/60 p-5 text-sm text-muted-foreground">
          <p className="mb-0">
            Summary (not legal advice): Onramp deposits may be delayed or
            reversed by your bank or the onramp provider. Swaps and savings
            yields depend on third-party liquidity and protocols and can change
            at any time. Using smart contracts and lending pools involves risk,
            including loss of funds.
          </p>
        </div>
      </div>
    </main>
  );
};

export default Terms;
