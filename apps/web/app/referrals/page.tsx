"use client";

import { Container } from "@/components/ui/container";
import { StatCard } from "@/components/exchange";

const secondaryBtn =
  "inline-flex items-center justify-center h-9 px-3 rounded-md bg-bg border border-border text-text hover:bg-bg-hover transition-colors text-sm";

export default function ReferralsPage() {
  const shareLink = "https://exchange.local/signup?ref=YOUR-CODE";

  return (
    <Container className="py-10 max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-text">
          Referrals
        </h1>
        <p className="text-sm text-text-dim mt-1">
          Invite friends. Earn 20% of their trading fees for the first 90 days.
        </p>
      </div>

      <div className="grid sm:grid-cols-3 gap-4">
        <StatCard label="Referrals" value="0" hint="No one yet" />
        <StatCard label="Earned" value="$0.00" hint="Lifetime" />
        <StatCard label="Pending payout" value="$0.00" hint="Settles weekly" />
      </div>

      <section className="rounded-lg border border-border bg-bg-elevated p-6 space-y-4">
        <h2 className="text-sm font-semibold text-text">Your referral link</h2>
        <div className="flex gap-2">
          <code className="flex-1 rounded-md border border-border bg-bg p-3 text-sm font-mono text-text overflow-x-auto">
            {shareLink}
          </code>
          <button
            type="button"
            className={secondaryBtn}
            onClick={() => navigator.clipboard.writeText(shareLink)}
          >
            Copy
          </button>
        </div>
        <p className="text-xs text-text-mute">
          Anyone who signs up using this link earns you 20% of their trading
          fees for 90 days.
        </p>
      </section>

      <section className="rounded-lg border border-border bg-bg-elevated p-6 space-y-3">
        <h2 className="text-sm font-semibold text-text">How it works</h2>
        <ol className="space-y-3 text-sm text-text-dim list-decimal pl-5">
          <li>
            <span className="text-text font-medium">Share your link.</span>{" "}
            Send to friends, post on socials, embed in your newsletter.
          </li>
          <li>
            <span className="text-text font-medium">They sign up.</span>{" "}
            New users who complete KYC tier 1 are tagged to you for 90 days.
          </li>
          <li>
            <span className="text-text font-medium">They trade.</span> You earn
            20% of their net trading fees, paid out weekly.
          </li>
        </ol>
      </section>

      <section className="rounded-lg border border-border-subtle bg-bg p-4">
        <p className="text-xs text-text-mute">
          Lab environment — referral fees are simulated and do not represent
          real value.
        </p>
      </section>
    </Container>
  );
}
