"use client";

import { Container } from "@/components/ui/container";

export default function BugBountyPage() {
  return (
    <Container className="py-10 max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-text">
          Bug bounty
        </h1>
        <p className="text-sm text-text-dim mt-1">
          Help us keep BVBE secure. Coordinated disclosure rewards in our scope.
        </p>
      </div>

      <section className="rounded-lg border border-border bg-bg-elevated p-6 space-y-3">
        <h2 className="text-sm font-semibold text-text">Rewards</h2>
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase tracking-wider text-text-mute">
            <tr>
              <th className="pb-2">Severity</th>
              <th className="pb-2 text-right">Reward</th>
            </tr>
          </thead>
          <tbody className="font-mono tabular-nums">
            <tr className="border-t border-border-subtle">
              <td className="py-2 text-sell">Critical</td>
              <td className="py-2 text-right">$10,000 – $50,000</td>
            </tr>
            <tr className="border-t border-border-subtle">
              <td className="py-2 text-warn">High</td>
              <td className="py-2 text-right">$2,500 – $10,000</td>
            </tr>
            <tr className="border-t border-border-subtle">
              <td className="py-2 text-text-dim">Medium</td>
              <td className="py-2 text-right">$500 – $2,500</td>
            </tr>
            <tr className="border-t border-border-subtle">
              <td className="py-2 text-text-mute">Low</td>
              <td className="py-2 text-right">$100 – $500</td>
            </tr>
          </tbody>
        </table>
      </section>

      <section className="rounded-lg border border-border bg-bg-elevated p-6 space-y-3">
        <h2 className="text-sm font-semibold text-text">In scope</h2>
        <ul className="space-y-1 text-sm text-text-dim list-disc pl-5">
          <li>All endpoints under <code className="font-mono text-text">api.exchange.local/v2</code></li>
          <li>Web application at <code className="font-mono text-text">exchange.local</code></li>
          <li>Authentication, account takeover, IDOR, business logic</li>
          <li>Smart contract / treasury signing flows</li>
        </ul>
      </section>

      <section className="rounded-lg border border-border bg-bg-elevated p-6 space-y-3">
        <h2 className="text-sm font-semibold text-text">Out of scope</h2>
        <ul className="space-y-1 text-sm text-text-dim list-disc pl-5">
          <li>Social engineering of staff or users</li>
          <li>Physical attacks against our offices</li>
          <li>DOS / DDoS / volumetric resource exhaustion</li>
          <li>Self-XSS, rate limits, or best-practice missing-header reports</li>
          <li>Anything found via automated scanners without manual triage</li>
        </ul>
      </section>

      <section className="rounded-lg border border-border bg-bg-elevated p-6 space-y-3">
        <h2 className="text-sm font-semibold text-text">Submit a report</h2>
        <p className="text-sm text-text-dim">
          Email a clear writeup, repro steps, and (if possible) a video PoC to:
        </p>
        <a
          href="mailto:security@bvbe.local"
          className="inline-block font-mono text-accent hover:underline"
        >
          security@bvbe.local
        </a>
        <p className="text-xs text-text-mute pt-3 border-t border-border-subtle">
          Lab environment — bounty payouts are illustrative.
        </p>
      </section>
    </Container>
  );
}
