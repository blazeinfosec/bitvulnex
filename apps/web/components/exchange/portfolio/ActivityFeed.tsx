import Link from "next/link";
import { DataTable, type Column } from "../DataTable";
import { EmptyState } from "../EmptyState";

export interface ActivityRow {
  kind: string;
  ts: string;
  asset?: string;
  amount?: string;
  pair?: string;
  label: string;
  link?: string;
}

export interface ActivityFeedProps {
  events: ActivityRow[];
  /** Cap how many rows the scroller actually mounts. */
  limit?: number;
}

function formatTs(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${y}-${m}-${day} ${hh}:${mm} UTC`;
}

const KIND_LABEL: Record<string, string> = {
  deposit: "Deposit",
  withdrawal: "Withdraw",
  transfer_in: "Transfer in",
  transfer_out: "Transfer out",
  trade: "Trade",
  order_placed: "Order placed",
  order_cancelled: "Order cancelled",
  stake: "Stake",
  unstake: "Unstake",
  supply: "Supply",
  supply_withdraw: "Supply withdraw",
  borrow: "Borrow",
  repay: "Repay",
  otc: "OTC",
  p2p: "P2P",
};

function KindPill({ kind }: { kind: string }) {
  const greenish = ["deposit", "trade", "transfer_in", "supply", "stake"];
  const reddish = [
    "withdrawal",
    "transfer_out",
    "borrow",
    "supply_withdraw",
    "unstake",
  ];
  const cls = greenish.includes(kind)
    ? "text-buy bg-buy/10 border-buy/20"
    : reddish.includes(kind)
      ? "text-sell bg-sell/10 border-sell/20"
      : "text-text-dim bg-bg border-border";
  return (
    <span
      className={`inline-block text-xs px-2 py-0.5 rounded border ${cls}`}
    >
      {KIND_LABEL[kind] ?? kind}
    </span>
  );
}

export function ActivityFeed({ events, limit = 50 }: ActivityFeedProps) {
  const rows = events.slice(0, limit);
  const columns: Column<ActivityRow>[] = [
    {
      key: "ts",
      header: "Time",
      render: (e) => (
        <span className="text-xs text-text-dim font-mono whitespace-nowrap">
          {formatTs(e.ts)}
        </span>
      ),
    },
    {
      key: "kind",
      header: "Kind",
      render: (e) => <KindPill kind={e.kind} />,
    },
    {
      key: "label",
      header: "Detail",
      render: (e) =>
        e.link ? (
          <Link
            href={e.link}
            className="text-sm text-text hover:text-accent hover:underline"
          >
            {e.label}
          </Link>
        ) : (
          <span className="text-sm text-text">{e.label}</span>
        ),
    },
  ];

  return (
    <div className="max-h-[480px] overflow-y-auto rounded-lg border border-border bg-bg-elevated">
      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(e) => `${e.kind}:${e.ts}:${e.label}`}
        empty={
          <EmptyState
            title="No activity yet"
            description="Your recent deposits, trades, stakes, and transfers will appear here."
          />
        }
        className="border-0"
      />
    </div>
  );
}
