// Shared USD-equity math. The worker (apps/worker/src/equity-snapshot.ts)
// snapshots this value nightly (lab cadence: 5 min) and the dashboard
// route (apps/web/app/api/v2/me/dashboard/route.ts) re-computes the
// "live today" value the same way so the 24h delta math agrees.
//
// Slice-5 L7 review M-1 caught the route computing only spot +
// marginAvailable + lending principal + staking principal while the
// worker also folded in lending accrued + margin collateral +
// unrealized margin P&L. This module is the canonical source so both
// call sites stay aligned.
//
// Composition of `totalUsd`:
//   - Spot subtotal: `amount` (which is available + locked) per asset
//   - Margin sub-account: `marginAvailable` per asset. `marginBorrowed`
//     is NOT user-owned and is excluded.
//   - Lending positions: principal + accrued for both sides. Borrow
//     positions reduce equity (debt).
//   - Staking positions: principal. Rewards already accumulate into
//     spot balance via the staking-rewards worker, so no double count.
//   - Margin positions: collateral + unrealized P&L =
//     size * (markPrice - entryPrice) for long, inverse for short.
//     The collateral has already moved out of marginAvailable into
//     the position, so we add it back here.

import { Prisma } from "@bvbe/db";

const D = (s: string | number | Prisma.Decimal) => new Prisma.Decimal(s);

export interface EquityInputBalance {
  asset: string;
  amount: Prisma.Decimal | string;
  marginAvailable: Prisma.Decimal | string;
}

export interface EquityInputLending {
  pool: string;
  side: "supply" | "borrow";
  principal: Prisma.Decimal | string;
  accrued: Prisma.Decimal | string;
}

export interface EquityInputStaking {
  asset: string;
  principal: Prisma.Decimal | string;
}

export interface EquityInputMargin {
  pair: string;
  side: "long" | "short";
  size: Prisma.Decimal | string;
  entryPrice: Prisma.Decimal | string;
  collateral: Prisma.Decimal | string;
  collateralAsset: string;
  /** Latest pair-quoted trade price; null when none exists. */
  markPrice: Prisma.Decimal | string | null;
}

export interface EquityInputs {
  balances: EquityInputBalance[];
  lending: EquityInputLending[];
  staking: EquityInputStaking[];
  margin: EquityInputMargin[];
  /** Asset -> USD price lookup; assets with no price contribute 0. */
  priceUsd: (asset: string) => Prisma.Decimal;
}

export function computeUserEquityUsd(inputs: EquityInputs): Prisma.Decimal {
  let total = D("0");

  for (const b of inputs.balances) {
    const px = inputs.priceUsd(b.asset);
    if (px.lte(0)) continue;
    total = total.add(D(b.amount).mul(px));
    total = total.add(D(b.marginAvailable).mul(px));
  }

  for (const lp of inputs.lending) {
    const px = inputs.priceUsd(lp.pool);
    if (px.lte(0)) continue;
    const value = D(lp.principal).add(D(lp.accrued)).mul(px);
    total = lp.side === "supply" ? total.add(value) : total.sub(value);
  }

  for (const sp of inputs.staking) {
    const px = inputs.priceUsd(sp.asset);
    if (px.lte(0)) continue;
    total = total.add(D(sp.principal).mul(px));
  }

  for (const p of inputs.margin) {
    const collPx = inputs.priceUsd(p.collateralAsset);
    if (collPx.gt(0)) {
      total = total.add(D(p.collateral).mul(collPx));
    }
    if (p.markPrice === null) continue;
    const mark = D(p.markPrice);
    const entry = D(p.entryPrice);
    const size = D(p.size);
    const diff = p.side === "long" ? mark.sub(entry) : entry.sub(mark);
    const quote = p.pair.split("/")[1] ?? "USDT";
    const quotePx = inputs.priceUsd(quote);
    if (quotePx.lte(0)) continue;
    total = total.add(size.mul(diff).mul(quotePx));
  }

  return total;
}
