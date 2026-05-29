"use client";

import { Container } from "@/components/ui/container";
import { DataTable, type Column, EmptyState } from "@/components/exchange";

type Sub = {
  id: string;
  label: string;
  balance: string;
  status: string;
};

const disabledBtn =
  "inline-flex items-center justify-center h-9 px-4 rounded-md bg-bg border border-border text-text-mute text-sm cursor-not-allowed opacity-60";

export default function SubaccountsPage() {
  const rows: Sub[] = [];

  const cols: Column<Sub>[] = [
    { key: "label", header: "Label", render: (s) => s.label },
    {
      key: "balance",
      header: "Balance",
      align: "right",
      render: (s) => (
        <span className="font-mono tabular-nums">{s.balance}</span>
      ),
    },
    { key: "status", header: "Status", render: (s) => s.status },
  ];

  return (
    <Container className="py-10 max-w-4xl space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-text">
            Sub-accounts
          </h1>
          <p className="text-sm text-text-dim mt-1">
            Segregate strategies, trading desks, or team members under one
            master account.
          </p>
        </div>
        <button
          type="button"
          className={disabledBtn}
          disabled
          title="Coming soon to this lab"
        >
          + Create sub-account
        </button>
      </div>

      <DataTable<Sub>
        columns={cols}
        rows={rows}
        rowKey={(s) => s.id}
        empty={
          <EmptyState
            title="No sub-accounts yet"
            description="Sub-account management is coming soon to this lab environment."
          />
        }
      />

      <section className="rounded-lg border border-border bg-bg-elevated p-6 space-y-3">
        <h2 className="text-sm font-semibold text-text">Coming soon</h2>
        <ul className="space-y-2 text-sm text-text-dim list-disc pl-5">
          <li>Up to 200 sub-accounts per master account</li>
          <li>Per-sub-account API keys with scoped permissions</li>
          <li>Cross-sub-account internal transfers (fee-free)</li>
          <li>Consolidated treasury reporting</li>
        </ul>
      </section>
    </Container>
  );
}
