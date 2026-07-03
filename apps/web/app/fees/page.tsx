import type { Metadata } from "next";
import { Container } from "@/components/ui/container";
import { FEE_TABLE, type FeeTier } from "@/lib/engine/fees";

export const metadata: Metadata = {
  title: "Fee schedule · Bitvulnex",
};

// Volume thresholds mirror TIER_THRESHOLD in lib/engine/fees.ts. The
// bps values come straight from FEE_TABLE so this page can't drift from
// what the matching engine actually charges.
const TIERS: Array<{ tier: FeeTier; label: string; volume: string }> = [
  { tier: "base", label: "Base", volume: "Under $50,000" },
  { tier: "vip", label: "VIP", volume: "$50,000+" },
  { tier: "prime", label: "Prime", volume: "$1,000,000+" },
];

function pct(bps: number): string {
  return `${(bps / 100).toFixed(2)}%`;
}

const WITHDRAWAL_FEES: Array<{ asset: string; fee: string }> = [
  { asset: "BTC", fee: "0.00010000 BTC" },
  { asset: "ETH", fee: "0.00100000 ETH" },
  { asset: "LTC", fee: "0.00100000 LTC" },
  { asset: "USDT", fee: "1.00 USDT" },
];

export default function FeesPage() {
  return (
    <Container className="py-10 max-w-4xl space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-text">
          Fee schedule
        </h1>
        <p className="text-sm text-text-dim mt-1 max-w-2xl">
          Spot trading fees are tiered by your trailing 30-day traded
          volume. Your tier is recalculated continuously — no opt-in
          required. Maker orders add liquidity to the book; taker orders
          remove it.
        </p>
      </div>

      <section className="rounded-lg border border-border bg-bg-elevated overflow-hidden">
        <div className="px-5 py-3 border-b border-border">
          <h2 className="text-sm font-semibold text-text">Spot trading</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-text-mute text-xs uppercase tracking-wider">
              <tr className="border-b border-border-subtle">
                <th className="px-5 py-2 font-medium">Tier</th>
                <th className="px-5 py-2 font-medium">30-day volume</th>
                <th className="px-5 py-2 font-medium text-right">Maker</th>
                <th className="px-5 py-2 font-medium text-right">Taker</th>
              </tr>
            </thead>
            <tbody>
              {TIERS.map((t) => (
                <tr
                  key={t.tier}
                  className="border-b border-border-subtle last:border-0"
                >
                  <td className="px-5 py-3 font-medium text-text">{t.label}</td>
                  <td className="px-5 py-3 text-text-dim">{t.volume}</td>
                  <td className="px-5 py-3 text-right font-tabular text-text">
                    {pct(FEE_TABLE[t.tier].makerBps)}
                  </td>
                  <td className="px-5 py-3 text-right font-tabular text-text">
                    {pct(FEE_TABLE[t.tier].takerBps)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-lg border border-border bg-bg-elevated overflow-hidden">
        <div className="px-5 py-3 border-b border-border">
          <h2 className="text-sm font-semibold text-text">Withdrawals</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-text-mute text-xs uppercase tracking-wider">
              <tr className="border-b border-border-subtle">
                <th className="px-5 py-2 font-medium">Asset</th>
                <th className="px-5 py-2 font-medium text-right">
                  Network fee
                </th>
              </tr>
            </thead>
            <tbody>
              {WITHDRAWAL_FEES.map((w) => (
                <tr
                  key={w.asset}
                  className="border-b border-border-subtle last:border-0"
                >
                  <td className="px-5 py-3 font-medium text-text">{w.asset}</td>
                  <td className="px-5 py-3 text-right font-tabular text-text">
                    {w.fee}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="px-5 py-3 text-xs text-text-mute border-t border-border-subtle">
          Deposits are free. OTC desk quotes settle at 25 bps taker unless a
          maker relationship applies. Internal transfers between Bitvulnex
          accounts carry no fee.
        </p>
      </section>
    </Container>
  );
}
