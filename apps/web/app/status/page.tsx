"use client";

import { Container } from "@/components/ui/container";

type Service = {
  name: string;
  status: "operational" | "degraded" | "outage";
  description: string;
};

const services: Service[] = [
  { name: "Spot trading", status: "operational", description: "Order placement, matching, fills" },
  { name: "Market data", status: "operational", description: "Order book, trades, candles, ticker" },
  { name: "Deposits", status: "operational", description: "On-chain BTC, ERC-20" },
  { name: "Withdrawals", status: "operational", description: "On-chain BTC, ERC-20, internal" },
  { name: "OTC desk", status: "operational", description: "Block-size quoting" },
  { name: "P2P market", status: "operational", description: "Escrowed peer trades" },
  { name: "Lending & staking", status: "operational", description: "Earn dashboard, yield accrual" },
  { name: "KYC review", status: "operational", description: "Document submission and approval" },
  { name: "Account / Auth", status: "operational", description: "Sign-in, 2FA, API keys" },
];

function dotColor(s: Service["status"]) {
  switch (s) {
    case "operational":
      return "bg-buy";
    case "degraded":
      return "bg-warn";
    case "outage":
      return "bg-sell";
  }
}

function statusLabel(s: Service["status"]) {
  switch (s) {
    case "operational":
      return "Operational";
    case "degraded":
      return "Degraded";
    case "outage":
      return "Outage";
  }
}

function statusClass(s: Service["status"]) {
  switch (s) {
    case "operational":
      return "text-buy";
    case "degraded":
      return "text-warn";
    case "outage":
      return "text-sell";
  }
}

export default function StatusPage() {
  return (
    <Container className="py-10 max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-text">
          System status
        </h1>
        <p className="text-sm text-text-dim mt-1">
          Real-time platform health.
        </p>
      </div>

      <div className="rounded-lg border border-buy/40 bg-buy/10 p-4 flex items-center gap-3">
        <span className="relative flex h-3 w-3">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-buy opacity-75" />
          <span className="relative inline-flex rounded-full h-3 w-3 bg-buy" />
        </span>
        <span className="text-buy font-semibold">All systems operational</span>
      </div>

      <section>
        <h2 className="text-xs uppercase tracking-wider text-text-mute font-medium mb-2">
          Services
        </h2>
        <ul className="rounded-lg border border-border bg-bg-elevated divide-y divide-border-subtle">
          {services.map((s) => (
            <li
              key={s.name}
              className="flex items-center justify-between px-4 py-3"
            >
              <div className="flex items-center gap-3">
                <span
                  className={`inline-block w-2 h-2 rounded-full ${dotColor(s.status)}`}
                />
                <div>
                  <div className="text-sm text-text">{s.name}</div>
                  <div className="text-xs text-text-mute">{s.description}</div>
                </div>
              </div>
              <span className={`text-sm font-medium ${statusClass(s.status)}`}>
                {statusLabel(s.status)}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className="rounded-lg border border-border bg-bg-elevated p-6 space-y-3">
        <h2 className="text-sm font-semibold text-text">Recent incidents</h2>
        <div className="text-sm text-text-dim">
          <p>
            <span className="font-mono text-text-mute">2026-05-16 14:23 UTC</span>{" "}
            — Brief delay in deposit confirmations (peaked at 12 minutes).
            Resolved in under an hour. No funds affected.
          </p>
          <p className="mt-3 text-text-mute">
            Last incident: <span className="font-mono">12 days ago</span>.
          </p>
        </div>
      </section>
    </Container>
  );
}
