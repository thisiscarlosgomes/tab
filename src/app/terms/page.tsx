import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Terms of Service",
  description: "Terms of Service for Tab.",
};

const LAST_UPDATED = "February 28, 2026";

function LegalLayout({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <main className="min-h-screen bg-background text-white">
      <div className="mx-auto flex w-full max-w-3xl flex-col px-6 pb-20 pt-16">
        <Link
          href="/"
          className="mb-8 text-sm text-white/50 transition-colors hover:text-white"
        >
          Back to Tab
        </Link>
        <h1 className="text-4xl font-semibold tracking-tight">{title}</h1>
        <p className="mt-3 text-sm text-white/45">Last updated: {LAST_UPDATED}</p>
        <div className="mt-10 space-y-8 text-sm leading-7 text-white/75">
          {children}
        </div>
      </div>
    </main>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h2 className="text-lg font-medium text-white">{title}</h2>
      <div className="mt-2 space-y-4">{children}</div>
    </section>
  );
}

export default function TermsPage() {
  return (
    <LegalLayout title="Terms of Service">
      <Section title="Acceptance of terms">
        <p>
          By accessing or using Tab, you agree to these Terms of Service. If you
          do not agree, do not use the service.
        </p>
      </Section>

      <Section title="Use of the service">
        <p>
          You may use Tab only in compliance with applicable law and only for
          lawful purposes. You are responsible for your account, connected
          wallets, linked identities, and any activity that occurs under your
          use of the service.
        </p>
      </Section>

      <Section title="Payments and wallets">
        <p>
          Tab may integrate with third-party wallet, authentication, payment,
          and blockchain infrastructure providers. Digital asset transactions
          may be irreversible, delayed, or affected by third-party systems
          outside our control.
        </p>
      </Section>

      <Section title="User content and conduct">
        <p>
          You may not use Tab to engage in fraud, abuse, unauthorized access,
          sanctions evasion, money laundering, infringement, or any activity
          that harms other users, third parties, or the service.
        </p>
      </Section>

      <Section title="Third-party services">
        <p>
          Tab may rely on third-party services such as identity providers, X,
          Farcaster, wallet providers, and blockchain networks. We are not
          responsible for third-party products, outages, policy changes, or data
          provided by those services.
        </p>
      </Section>

      <Section title="Disclaimers">
        <p>
          Tab is provided on an “as is” and “as available” basis without
          warranties of any kind, to the fullest extent permitted by law. We do
          not guarantee uninterrupted availability, security, or error-free
          operation.
        </p>
      </Section>

      <Section title="Limitation of liability">
        <p>
          To the maximum extent permitted by law, Tab and its affiliates will
          not be liable for indirect, incidental, special, consequential, or
          punitive damages, or for loss of profits, revenues, data, or digital
          assets arising from or related to your use of the service.
        </p>
      </Section>

      <Section title="Changes and contact">
        <p>
          We may update these terms from time to time. Continued use of Tab
          after updated terms become effective constitutes acceptance of the
          revised terms.
        </p>
        <p>
          For questions about these terms, contact{" "}
          <a
            href="mailto:hello@usetab.app"
            className="text-white underline underline-offset-4"
          >
            hello@usetab.app
          </a>
          .
        </p>
      </Section>
    </LegalLayout>
  );
}
