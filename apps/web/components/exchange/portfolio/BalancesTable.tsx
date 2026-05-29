import { DataTable, type Column } from "../DataTable";
import { NumberCell } from "../NumberCell";
import { EmptyState } from "../EmptyState";

export interface BalanceRow {
  asset: string;
  amount: string;
  available: string;
  locked: string;
  marginAvailable: string;
  marginBorrowed: string;
  usdValue: string;
}

export interface BalancesTableProps {
  balances: BalanceRow[];
  /** When true, render assets even when amount == 0. */
  showZero?: boolean;
}

export function BalancesTable({
  balances,
  showZero = false,
}: BalancesTableProps) {
  const rows = balances
    .filter((b) => showZero || Number(b.amount) > 0)
    .sort((a, b) => Number(b.usdValue) - Number(a.usdValue));

  const columns: Column<BalanceRow>[] = [
    {
      key: "asset",
      header: "Asset",
      render: (b) => <span className="font-medium text-text">{b.asset}</span>,
    },
    {
      key: "free",
      header: "Free",
      align: "right",
      render: (b) => <NumberCell value={b.available} />,
    },
    {
      key: "locked",
      header: "Locked",
      align: "right",
      render: (b) => (
        <NumberCell value={b.locked} className="text-text-dim" />
      ),
    },
    {
      key: "usd",
      header: "USD value",
      align: "right",
      render: (b) => (
        <NumberCell
          value={b.usdValue}
          dp={2}
          prefix="$"
          className="text-text"
        />
      ),
    },
  ];

  return (
    <DataTable
      columns={columns}
      rows={rows}
      rowKey={(b) => b.asset}
      empty={
        <EmptyState
          title="No balances yet"
          description="Deposit funds to start trading."
          action={{ label: "Deposit", href: "/account/deposit" }}
        />
      }
    />
  );
}
