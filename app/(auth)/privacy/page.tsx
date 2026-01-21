// app/privacy/page.tsx
import React from "react";
import Link from "next/link";

const PrivacyPage = () => {
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
            Privacy Policy
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Effective date: {new Date().toLocaleDateString()}
          </p>
        </div>

        {/* Intro */}
        <section className="prose prose-invert max-w-none">
          <p>
            This Privacy Policy explains how Haven Vaults (“Haven”, “we”, “us”,
            “our”) collects, uses, shares, and protects information when you use
            our website, mobile or web applications, and related services
            (collectively, the “Services”).
          </p>

          <p>
            We build Haven to be privacy-conscious and to collect only what we
            need to operate the Services. If you have questions, contact us at{" "}
            <a href="mailto:privacy@havenvaults.com">privacy@havenvaults.com</a>
            . (If you use a different email/domain, update this address.)
          </p>

          <hr />

          <h2>1. Information we collect</h2>

          <h3>1.1 Information you provide</h3>
          <p>
            When you create or use an account, we may store the following
            information in our database:
          </p>
          <ul>
            <li>Name (first name and/or last name)</li>
            <li>Email address</li>
            <li>Country</li>
            <li>Display currency preference</li>
            <li>Financial knowledge level (self-reported)</li>
            <li>Risk tolerance (self-reported)</li>
          </ul>

          <p>
            We may also store basic account metadata (for example, account
            creation time, last sign-in time) so we can provide the Services
            reliably and help prevent fraud and abuse.
          </p>

          <h3>1.2 Information collected automatically</h3>
          <p>
            Like most online services, we and our service providers may collect
            basic technical data when you access the Services, such as device
            and browser type, IP address, approximate location derived from IP,
            pages viewed, and timestamps. This information is used for security,
            reliability, and performance (for example, detecting suspicious
            activity or debugging errors).
          </p>

          <h3>1.3 Information related to transactions and public networks</h3>
          <p>
            Haven is built on modern settlement rails that may include public
            blockchain networks. Activity on those networks (for example,
            transaction hashes, public addresses, token movements, and balances)
            may be publicly visible and independently verifiable. We do not
            control these networks, and we cannot delete or modify public
            records once created.
          </p>

          <hr />

          <h2>2. How we use information</h2>
          <p>We use the information described above to:</p>
          <ul>
            <li>Provide, operate, and maintain the Services</li>
            <li>
              Personalize your experience (for example, currency display and
              product suitability settings)
            </li>
            <li>Process requests and provide customer support</li>
            <li>
              Protect the Services, our users, and our business from fraud,
              abuse, and security incidents
            </li>
            <li>Improve product performance, usability, and reliability</li>
            <li>Comply with applicable laws and enforce our terms</li>
          </ul>

          <p>
            We do not sell your personal information in the conventional sense.
          </p>

          <hr />

          <h2>3. How we share information</h2>
          <p>We may share information in the following circumstances:</p>

          <h3>3.1 Service providers</h3>
          <p>
            We use trusted vendors to help us run the Services (for example,
            cloud hosting, database infrastructure, analytics, customer support,
            and communications). These providers may process information on our
            behalf under contractual obligations designed to protect it and use
            it only for providing services to us.
          </p>

          <h3>3.2 Legal, safety, and compliance</h3>
          <p>
            We may disclose information if we believe doing so is reasonably
            necessary to comply with law, regulation, legal process, or
            government request; to protect the security or integrity of the
            Services; or to protect the rights, property, or safety of Haven,
            our users, or others.
          </p>

          <h3>3.3 Business transfers</h3>
          <p>
            If we are involved in a merger, acquisition, financing, due
            diligence, reorganization, bankruptcy, receivership, sale of company
            assets, or transition of service to another provider, your
            information may be shared or transferred as part of that
            transaction.
          </p>

          <hr />

          <h2>4. Data retention</h2>
          <p>
            We retain personal information for as long as needed to provide the
            Services and for legitimate business purposes such as security,
            compliance, and dispute resolution. Retention periods may vary based
            on the type of information and the reason we process it.
          </p>

          <hr />

          <h2>5. Security</h2>
          <p>
            We implement administrative, technical, and organizational measures
            intended to protect information from unauthorized access, loss,
            misuse, or alteration. No system can be guaranteed 100% secure, and
            you are responsible for maintaining the confidentiality of your
            credentials and using appropriate security controls on your devices.
          </p>

          <hr />

          <h2>6. Your choices and rights</h2>
          <p>
            Depending on where you live, you may have rights to access, correct,
            delete, or object to certain processing of your personal
            information. You may also have the right to withdraw consent where
            consent is the basis for processing.
          </p>
          <p>
            To exercise these rights, contact us at{" "}
            <a href="mailto:privacy@havenvaults.com">privacy@havenvaults.com</a>
            . We may need to verify your request before responding.
          </p>

          <hr />

          <h2>7. Cookies and similar technologies</h2>
          <p>
            We may use cookies and similar technologies to operate the Services,
            remember preferences, and understand usage. You can control cookies
            through your browser settings. Some features may not function
            properly if cookies are disabled.
          </p>

          <hr />

          <h2>8. International data transfers</h2>
          <p>
            If you access the Services from outside the country where our
            servers or service providers are located, your information may be
            transferred across borders and processed in other jurisdictions that
            may have different data protection laws.
          </p>

          <hr />

          <h2>9. Children’s privacy</h2>
          <p>
            The Services are not directed to children under 13, and we do not
            knowingly collect personal information from children under 13. If
            you believe a child has provided us personal information, please
            contact us so we can take appropriate steps.
          </p>

          <hr />

          <h2>10. Changes to this policy</h2>
          <p>
            We may update this Privacy Policy from time to time. If we make
            material changes, we will post the updated policy on this page and
            update the “Effective date” above. Your continued use of the
            Services after changes become effective constitutes acceptance of
            the updated policy.
          </p>

          <hr />

          <h2>11. Contact</h2>
          <p>
            Questions or requests regarding privacy can be sent to{" "}
            <a href="mailto:privacy@havenvaults.com">privacy@havenvaults.com</a>
            .
          </p>
        </section>

        {/* Footer note */}
        <div className="mt-10 rounded-2xl border border-border bg-background/60 p-5 text-sm text-muted-foreground">
          <p className="mb-0">
            Note: Some activity may occur on public networks where transaction
            records are visible to the public. This policy covers information
            processed by Haven; it does not change how public networks store or
            display data.
          </p>
        </div>
      </div>
    </main>
  );
};

export default PrivacyPage;
