import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: "Privacy Policy for Tab.",
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

export default function PrivacyPage() {
  return (
    <LegalLayout title="Privacy Policy">
      <Section title="Overview">
        <p>
          Tab is a social payments application that lets users create accounts,
          connect a wallet, link social profiles, send and receive payments, and
          access related financial tools.
        </p>
      </Section>

      <Section title="Information we collect">
        <p>
          We may collect account information such as your email address,
          connected wallet addresses, linked social account identifiers,
          usernames, profile images, and payment activity within the product.
        </p>
        <p>
          When you choose to connect social providers such as X or Farcaster, we
          may receive profile data and other permissions you explicitly
          authorize, such as your social graph for in-product discovery and
          recipient resolution.
        </p>
      </Section>

      <Section title="How we use information">
        <p>
          We use the information we collect to provide Tab, authenticate users,
          prevent fraud, create and manage wallets, process and display payment
          activity, personalize recipient discovery, and support customer
          service and product improvements.
        </p>
      </Section>

      <Section title="Sharing">
        <p>
          We may share information with service providers that help us operate
          the product, including authentication, wallet, analytics, hosting, and
          infrastructure providers. We may also disclose information when
          required by law or to protect the safety, rights, or integrity of Tab
          and its users.
        </p>
      </Section>

      <Section title="Data retention">
        <p>
          We retain information for as long as reasonably necessary to provide
          the service, comply with legal obligations, resolve disputes, and
          enforce agreements.
        </p>
      </Section>

      <Section title="Your choices">
        <p>
          You may choose whether to link certain social accounts, and you can
          stop using the service at any time. Some information may remain in our
          records where required for security, compliance, accounting, or
          operational reasons.
        </p>
      </Section>

      <Section title="Contact">
        <p>
          For privacy questions, contact Tab at{" "}
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
