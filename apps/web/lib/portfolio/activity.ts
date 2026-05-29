// Activity-feed merge logic for the /portfolio dashboard. Pure function
// over already-fetched rows so we can unit-test it without a DB.

export type ActivityKind =
  | "deposit"
  | "withdrawal"
  | "transfer_in"
  | "transfer_out"
  | "trade"
  | "order_placed"
  | "order_cancelled"
  | "stake"
  | "unstake"
  | "supply"
  | "supply_withdraw"
  | "borrow"
  | "repay"
  | "otc"
  | "p2p";

export interface ActivityEvent {
  kind: ActivityKind;
  ts: string; // ISO timestamp
  asset?: string;
  amount?: string;
  pair?: string;
  label: string;
  link?: string;
}

// Input row shapes — match Prisma's `Decimal` via string toString().
export interface DepositRow {
  asset: string;
  amount: string;
  creditedAt: Date | null;
  seenAt: Date;
  status: string;
}

export interface WithdrawalRow {
  asset: string;
  amount: string;
  requestedAt: Date;
  status: string;
  destAddress: string;
}

export interface InternalTransferRow {
  asset: string;
  amount: string;
  createdAt: Date;
  direction: "in" | "out";
  counterparty?: string | null;
}

export interface TradeRow {
  pair: string;
  amount: string;
  price: string;
  executedAt: Date;
  side: "buy" | "sell"; // from the user's perspective
}

export interface OrderRow {
  pair: string;
  side: "buy" | "sell";
  type: string;
  amount: string;
  price: string | null;
  status: string;
  createdAt: Date;
  cancelledAt: Date | null;
}

export interface StakingPositionRow {
  asset: string;
  principal: string;
  startedAt: Date;
  unstakedAt: Date | null;
}

export interface LendingPositionRow {
  pool: string;
  side: "supply" | "borrow";
  principal: string;
  openedAt: Date;
  closedAt: Date | null;
}

export interface OtcRow {
  pair: string;
  side: "buy" | "sell";
  amount: string;
  filledAt: Date;
}

export interface P2pRow {
  asset: string;
  amount: string;
  releasedAt: Date;
  role: "buyer" | "seller";
}

export interface ActivityInput {
  deposits: DepositRow[];
  withdrawals: WithdrawalRow[];
  transfers: InternalTransferRow[];
  trades: TradeRow[];
  orders: OrderRow[];
  stakes: StakingPositionRow[];
  lending: LendingPositionRow[];
  otc: OtcRow[];
  p2p: P2pRow[];
}

function tradePairSlug(pair: string): string {
  // "BTC/USDT" -> "BTC-USDT"
  return pair.replace("/", "-");
}

export function buildActivityFeed(
  input: ActivityInput,
  limit = 50,
): ActivityEvent[] {
  const events: ActivityEvent[] = [];

  for (const d of input.deposits) {
    // Use creditedAt if the deposit cleared, else seenAt for in-flight.
    const ts = (d.creditedAt ?? d.seenAt).toISOString();
    events.push({
      kind: "deposit",
      ts,
      asset: d.asset,
      amount: d.amount,
      label: `Deposit ${d.amount} ${d.asset} (${d.status})`,
      link: "/account/deposit",
    });
  }

  for (const w of input.withdrawals) {
    events.push({
      kind: "withdrawal",
      ts: w.requestedAt.toISOString(),
      asset: w.asset,
      amount: w.amount,
      label: `Withdraw ${w.amount} ${w.asset} (${w.status})`,
      link: "/withdraw",
    });
  }

  for (const t of input.transfers) {
    events.push({
      kind: t.direction === "in" ? "transfer_in" : "transfer_out",
      ts: t.createdAt.toISOString(),
      asset: t.asset,
      amount: t.amount,
      label:
        t.direction === "in"
          ? `Received ${t.amount} ${t.asset}` +
            (t.counterparty ? ` from ${t.counterparty}` : "")
          : `Sent ${t.amount} ${t.asset}` +
            (t.counterparty ? ` to ${t.counterparty}` : ""),
      link: "/transfer",
    });
  }

  for (const tr of input.trades) {
    events.push({
      kind: "trade",
      ts: tr.executedAt.toISOString(),
      pair: tr.pair,
      amount: tr.amount,
      label:
        `${tr.side === "buy" ? "Bought" : "Sold"} ` +
        `${tr.amount} ${tr.pair} @ ${tr.price}`,
      link: `/trade/${tradePairSlug(tr.pair)}`,
    });
  }

  for (const o of input.orders) {
    // Two events possible per order: placed (createdAt) and cancelled (cancelledAt).
    events.push({
      kind: "order_placed",
      ts: o.createdAt.toISOString(),
      pair: o.pair,
      amount: o.amount,
      label:
        `Placed ${o.type} ${o.side} ${o.amount} ${o.pair}` +
        (o.price ? ` @ ${o.price}` : ""),
      link: `/trade/${tradePairSlug(o.pair)}`,
    });
    if (o.cancelledAt) {
      events.push({
        kind: "order_cancelled",
        ts: o.cancelledAt.toISOString(),
        pair: o.pair,
        amount: o.amount,
        label: `Cancelled ${o.side} ${o.amount} ${o.pair}`,
        link: `/trade/${tradePairSlug(o.pair)}`,
      });
    }
  }

  for (const s of input.stakes) {
    events.push({
      kind: "stake",
      ts: s.startedAt.toISOString(),
      asset: s.asset,
      amount: s.principal,
      label: `Staked ${s.principal} ${s.asset}`,
      link: "/earn?tab=staking",
    });
    if (s.unstakedAt) {
      events.push({
        kind: "unstake",
        ts: s.unstakedAt.toISOString(),
        asset: s.asset,
        amount: s.principal,
        label: `Unstaked ${s.principal} ${s.asset}`,
        link: "/earn?tab=staking",
      });
    }
  }

  for (const lp of input.lending) {
    if (lp.side === "supply") {
      events.push({
        kind: "supply",
        ts: lp.openedAt.toISOString(),
        asset: lp.pool,
        amount: lp.principal,
        label: `Supplied ${lp.principal} ${lp.pool}`,
        link: "/earn?tab=lending",
      });
      if (lp.closedAt) {
        events.push({
          kind: "supply_withdraw",
          ts: lp.closedAt.toISOString(),
          asset: lp.pool,
          amount: lp.principal,
          label: `Withdrew supply ${lp.principal} ${lp.pool}`,
          link: "/earn?tab=lending",
        });
      }
    } else {
      events.push({
        kind: "borrow",
        ts: lp.openedAt.toISOString(),
        asset: lp.pool,
        amount: lp.principal,
        label: `Borrowed ${lp.principal} ${lp.pool}`,
        link: "/earn?tab=lending",
      });
      if (lp.closedAt) {
        events.push({
          kind: "repay",
          ts: lp.closedAt.toISOString(),
          asset: lp.pool,
          amount: lp.principal,
          label: `Repaid ${lp.principal} ${lp.pool}`,
          link: "/earn?tab=lending",
        });
      }
    }
  }

  for (const o of input.otc) {
    events.push({
      kind: "otc",
      ts: o.filledAt.toISOString(),
      pair: o.pair,
      amount: o.amount,
      label: `OTC ${o.side} ${o.amount} ${o.pair}`,
      link: "/otc",
    });
  }

  for (const p of input.p2p) {
    events.push({
      kind: "p2p",
      ts: p.releasedAt.toISOString(),
      asset: p.asset,
      amount: p.amount,
      label: `P2P ${p.role === "buyer" ? "bought" : "sold"} ${p.amount} ${p.asset}`,
      link: "/p2p",
    });
  }

  // Sort newest first by timestamp.
  events.sort((a, b) => (a.ts < b.ts ? 1 : a.ts > b.ts ? -1 : 0));

  return events.slice(0, limit);
}
