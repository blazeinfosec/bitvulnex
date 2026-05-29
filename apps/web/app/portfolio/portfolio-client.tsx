"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Container } from "@/components/ui/container";
import {
  ActivityFeed,
  BalancesTable,
  BottomTabs,
  type EquityPoint,
  type BalanceRow,
  type ActivityRow,
  Skeleton,
  StatCard,
  TierProgressCard,
  WelcomeCard,
  type WelcomeStep,
  DataTable,
  type Column,
  EmptyState,
  NumberCell,
  PercentChangeCell,
} from "@/components/exchange";
import { authedFetch } from "@/lib/token-storage";
import { cn } from "@/lib/utils";

// Lazy import — the lightweight-charts library is ~50KB and only
// needed once we know we have data to plot.
const EquityCurve = dynamic(
  () => import("@/components/exchange/portfolio/EquityCurve").then((m) => m.EquityCurve),
  { ssr: false, loading: () => <Skeleton className="h-[320px] w-full" /> },
);

type TabKey = "orders" | "positions" | "earn";

interface DashboardPayload {
  user: {
    id: string;
    email: string;
    displayName: string | null;
    role: string;
    kycTier: number;
    emailVerified: boolean;
    totpEnabled: boolean;
    createdAt: string;
  };
  totals: {
    equityUsd: string;
    deltaUsd24h: string;
    deltaPct24h: number;
  };
  tier: {
    current: number;
    next: number | null;
    requirements: string[];
  };
  equitySnapshots: EquityPoint[];
  balances: BalanceRow[];
  counts: {
    openOrders: number;
    openPositions: number;
    openLendingSupplies: number;
    openLendingBorrows: number;
    openStakes: number;
  };
  activity: ActivityRow[];
  onboarding: {
    emailVerified: boolean;
    kycTier1Done: boolean;
    firstDepositDone: boolean;
    firstTradeDone: boolean;
    earnPositionOpen: boolean;
  };
}

function fmtUsd(s: string): string {
  const n = Number(s);
  if (!Number.isFinite(n)) return "$—";
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function fmtUsdDelta(s: string): string {
  const n = Number(s);
  if (!Number.isFinite(n)) return "$—";
  const sign = n >= 0 ? "+" : "-";
  return (
    sign +
    Math.abs(n).toLocaleString("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  );
}

export function PortfolioClient() {
  return (
    <Suspense fallback={<PortfolioSkeleton />}>
      <PortfolioInner />
    </Suspense>
  );
}

function PortfolioSkeleton() {
  return (
    <Container className="py-8 max-w-7xl">
      <Skeleton className="h-9 w-64 mb-2" />
      <Skeleton className="h-4 w-96 mb-6" />
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-28 w-full" />
      </div>
      <Skeleton className="h-[320px] w-full mb-6" />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Skeleton className="h-72 w-full" />
        <Skeleton className="h-72 w-full" />
      </div>
    </Container>
  );
}

function PortfolioInner() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const tabParam = (searchParams.get("tab") ?? "orders") as TabKey;
  const initialTab: TabKey =
    tabParam === "positions" || tabParam === "earn" ? tabParam : "orders";

  const [tab, setTab] = useState<TabKey>(initialTab);
  const [payload, setPayload] = useState<DashboardPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const next =
      tabParam === "positions" || tabParam === "earn" ? tabParam : "orders";
    setTab(next);
  }, [tabParam]);

  function switchTab(next: TabKey) {
    setTab(next);
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", next);
    router.replace(`${pathname}?${params.toString()}` as never);
  }

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    const res = await authedFetch("/api/v2/me/dashboard");
    if (res.status === 401) {
      router.replace(`/login?next=/portfolio`);
      return;
    }
    if (res.status === 403) {
      setErr(
        "Dashboard requires KYC Tier 1. Verify your identity to continue.",
      );
      setLoading(false);
      return;
    }
    if (!res.ok) {
      setErr("Could not load dashboard. Try again in a moment.");
      setLoading(false);
      return;
    }
    const body = (await res.json()) as DashboardPayload;
    setPayload(body);
    setLoading(false);
  }, [router]);

  useEffect(() => {
    void load();
  }, [load]);

  const welcomeSteps: WelcomeStep[] = useMemo(() => {
    const o = payload?.onboarding;
    return [
      {
        title: "Verify your email",
        description:
          "Confirm the address you signed up with so we can recover your account.",
        ctaLabel: "Verify email",
        ctaHref: "/account/security",
        done: Boolean(o?.emailVerified),
      },
      {
        title: "Complete KYC",
        description:
          "Unlock withdrawals, lending, staking, and higher daily limits.",
        ctaLabel: "Start KYC",
        ctaHref: "/account/kyc",
        done: Boolean(o?.kycTier1Done),
      },
      {
        title: "First deposit",
        description: "Fund your account with BTC from the deposit page.",
        ctaLabel: "Deposit BTC",
        ctaHref: "/account/deposit",
        done: Boolean(o?.firstDepositDone),
      },
      {
        title: "First trade",
        description: "Open a BTC/USDT trade to see the order book in action.",
        ctaLabel: "Start trading",
        ctaHref: "/trade/BTC-USDT",
        done: Boolean(o?.firstTradeDone),
      },
      {
        title: "Try Earn",
        description:
          "Supply liquidity to a lending pool or stake assets to earn APY.",
        ctaLabel: "Open Earn",
        ctaHref: "/earn",
        done: Boolean(o?.earnPositionOpen),
      },
    ];
  }, [payload]);

  if (loading) {
    return <PortfolioSkeleton />;
  }

  if (err) {
    return (
      <Container className="py-10 max-w-3xl">
        <div className="rounded-lg border border-warn/40 bg-warn/10 p-6">
          <h1 className="text-lg font-semibold text-warn mb-2">
            Portfolio unavailable
          </h1>
          <p className="text-sm text-text-dim mb-4">{err}</p>
          <Link
            href="/account/kyc"
            className="inline-flex items-center justify-center h-9 px-4 text-sm font-semibold rounded-md bg-warn text-bg hover:bg-warn/90 transition-colors"
          >
            Verify identity →
          </Link>
        </div>
      </Container>
    );
  }

  if (!payload) return null;

  const greeting = payload.user.displayName || payload.user.email.split("@")[0];
  const deltaNum = Number(payload.totals.deltaUsd24h);
  const deltaPct = payload.totals.deltaPct24h;

  return (
    <Container className="py-8 max-w-7xl">
      <div className="flex items-end justify-between gap-4 mb-6 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-text">
            Welcome back{greeting ? `, ${greeting}` : ""}
          </h1>
          <p className="text-sm text-text-dim mt-1">
            Your account at a glance — balances, equity, and recent activity.
          </p>
        </div>
        <div className="text-xs text-text-mute font-mono">
          Tier {payload.user.kycTier}
          {payload.user.totpEnabled ? " · 2FA on" : " · 2FA off"}
        </div>
      </div>

      <WelcomeCard steps={welcomeSteps} />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <StatCard
          label="Estimated balance"
          value={fmtUsd(payload.totals.equityUsd)}
          hint={
            <span className="text-text-mute">
              Across all spot + margin + earn
            </span>
          }
        />
        <StatCard
          label="24h P&amp;L"
          value={
            <span className={cn(deltaNum >= 0 ? "text-buy" : "text-sell")}>
              {fmtUsdDelta(payload.totals.deltaUsd24h)}
            </span>
          }
          hint={
            payload.equitySnapshots.length < 2 ? (
              <span className="text-text-mute">
                Awaiting first snapshot baseline
              </span>
            ) : (
              <PercentChangeCell value={deltaPct} />
            )
          }
        />
        <TierProgressCard
          current={payload.tier.current}
          next={payload.tier.next}
          requirements={payload.tier.requirements}
        />
      </div>

      <div className="mb-6">
        <EquityCurve snapshots={payload.equitySnapshots} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        <section>
          <h2 className="text-xs font-semibold text-text-mute uppercase tracking-wider mb-2">
            Balances
          </h2>
          <BalancesTable balances={payload.balances} />
        </section>
        <section>
          <h2 className="text-xs font-semibold text-text-mute uppercase tracking-wider mb-2">
            Recent activity
          </h2>
          <ActivityFeed events={payload.activity} />
        </section>
      </div>

      <section>
        <h2 className="text-xs font-semibold text-text-mute uppercase tracking-wider mb-2">
          Open positions &amp; orders
        </h2>
        <BottomTabs
          active={tab}
          onChange={(k) => switchTab(k as TabKey)}
          tabs={[
            {
              key: "orders",
              label: "Open orders",
              count: payload.counts.openOrders,
              content: <OrdersTabPlaceholder count={payload.counts.openOrders} />,
            },
            {
              key: "positions",
              label: "Open positions",
              count: payload.counts.openPositions,
              content: (
                <PositionsTabPlaceholder count={payload.counts.openPositions} />
              ),
            },
            {
              key: "earn",
              label: "Earn positions",
              count:
                payload.counts.openLendingSupplies +
                payload.counts.openLendingBorrows +
                payload.counts.openStakes,
              content: <EarnTabPlaceholder counts={payload.counts} />,
            },
          ]}
        />
      </section>
    </Container>
  );
}

// The bottom-tab content uses simple summary panels — each links out
// to the detailed page rather than duplicating the full data tables.
// This keeps the dashboard the "between actions" landing the plan
// describes, not yet-another-full-control-panel.

function OrdersTabPlaceholder({ count }: { count: number }) {
  if (count === 0) {
    return (
      <EmptyState
        title="No open orders"
        description="Place a limit, market, or stop-limit order from the trading page."
        action={{ label: "Open trading view", href: "/trade/BTC-USDT" }}
      />
    );
  }
  // Use a tiny DataTable to keep typing consistent.
  type Row = { label: string };
  const cols: Column<Row>[] = [
    {
      key: "label",
      header: "Summary",
      render: (r) => <span className="text-text">{r.label}</span>,
    },
    {
      key: "action",
      header: "",
      align: "right",
      render: () => (
        <Link
          href="/account/orders"
          className="text-xs text-accent hover:underline"
        >
          View all orders →
        </Link>
      ),
    },
  ];
  return (
    <DataTable
      columns={cols}
      rows={[
        {
          label: `${count} open order${count === 1 ? "" : "s"} across your active pairs`,
        },
      ]}
      rowKey={(r) => r.label}
      className="border-0 rounded-none"
    />
  );
}

function PositionsTabPlaceholder({ count }: { count: number }) {
  if (count === 0) {
    return (
      <EmptyState
        title="No open margin positions"
        description="Open a leveraged position from the trading page (KYC Tier 3 required for margin)."
        action={{ label: "Open trading view", href: "/trade/BTC-USDT" }}
      />
    );
  }
  type Row = { label: string };
  const cols: Column<Row>[] = [
    {
      key: "label",
      header: "Summary",
      render: (r) => <span className="text-text">{r.label}</span>,
    },
    {
      key: "action",
      header: "",
      align: "right",
      render: () => (
        <Link
          href="/account/margin"
          className="text-xs text-accent hover:underline"
        >
          View positions →
        </Link>
      ),
    },
  ];
  return (
    <DataTable
      columns={cols}
      rows={[
        {
          label: `${count} open margin position${count === 1 ? "" : "s"}`,
        },
      ]}
      rowKey={(r) => r.label}
      className="border-0 rounded-none"
    />
  );
}

function EarnTabPlaceholder({
  counts,
}: {
  counts: {
    openLendingSupplies: number;
    openLendingBorrows: number;
    openStakes: number;
  };
}) {
  const total =
    counts.openLendingSupplies + counts.openLendingBorrows + counts.openStakes;
  if (total === 0) {
    return (
      <EmptyState
        title="No earn positions"
        description="Supply, borrow, or stake assets from the Earn page."
        action={{ label: "Open Earn", href: "/earn" }}
      />
    );
  }
  type Row = { kind: string; count: number; href: string };
  const rows: Row[] = [
    {
      kind: "Lending supplies",
      count: counts.openLendingSupplies,
      href: "/earn?tab=lending",
    },
    {
      kind: "Lending borrows",
      count: counts.openLendingBorrows,
      href: "/earn?tab=lending",
    },
    {
      kind: "Active stakes",
      count: counts.openStakes,
      href: "/earn?tab=staking",
    },
  ].filter((r) => r.count > 0);
  const cols: Column<Row>[] = [
    {
      key: "kind",
      header: "Position",
      render: (r) => <span className="text-text">{r.kind}</span>,
    },
    {
      key: "count",
      header: "Count",
      align: "right",
      render: (r) => <NumberCell value={r.count} />,
    },
    {
      key: "action",
      header: "",
      align: "right",
      render: (r) => (
        <Link href={r.href} className="text-xs text-accent hover:underline">
          Open →
        </Link>
      ),
    },
  ];
  return (
    <DataTable
      columns={cols}
      rows={rows}
      rowKey={(r) => r.kind}
      className="border-0 rounded-none"
    />
  );
}
