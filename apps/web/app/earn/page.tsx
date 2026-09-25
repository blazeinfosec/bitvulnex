"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { Route } from "next";
import { Container } from "@/components/ui/container";
import { Button } from "@/components/ui/button";
import {
  BalancePill,
  DataTable,
  EmptyState,
  NumberCell,
  Skeleton,
  StatCard,
  type Column,
} from "@/components/exchange";
import {
  SupplyModal,
  WithdrawModal,
  BorrowModal,
  RepayModal,
  StakeModal,
  UnstakeModal,
  ClaimModal,
  type BorrowAvailableAsset,
} from "@/components/exchange/earn";
import { authedFetch } from "@/lib/token-storage";
import { cn } from "@/lib/utils";
import { formatDecimal } from "@/components/exchange/earn/modal-shared";

const EARN_TIER_REQUIRED = 1;

type TabKey = "lending" | "staking";

type Pool = {
  asset: string;
  supplied: string;
  borrowed: string;
  utilization: string;
  apyBaseBps: number;
  apySlopeBps: number;
  effectiveApyBps: number;
};

type LendingPosition = {
  id: string;
  pool: string;
  side: "supply" | "borrow";
  principal: string;
  accrued: string;
  collateralAsset: string | null;
  collateral: string | null;
  openedAt: string;
};

type StakingProgram = {
  id: string;
  asset: string;
  rewardAsset: string;
  apyBps: number;
  windowSeconds: number;
};

type StakingPosition = {
  id: string;
  asset: string;
  principal: string;
  status: "active" | "unstaking" | "ended";
  startedAt: string;
  unstakedAt: string | null;
  accrued: string;
  accruedWindows: number;
};

type Balance = {
  asset: string;
  available: string;
  amount: string;
  locked: string;
};

type Market = {
  pair: string;
  base: string;
  quote: string;
  last: string | null;
};

type Me = {
  id: string;
  email: string;
  displayName: string | null;
  role: string;
  kycTier: number;
};

type ToastState = { kind: "ok" | "err"; text: string } | null;

type ModalState =
  | { kind: "none" }
  | { kind: "supply"; asset: string; apyBps: number; available: string }
  | {
      kind: "withdraw";
      positionId: string;
      asset: string;
      principal: string;
      accrued: string;
    }
  | {
      kind: "borrow";
      asset: string;
      apyBps: number;
      collateralOptions: BorrowAvailableAsset[];
    }
  | {
      kind: "repay";
      positionId: string;
      asset: string;
      principal: string;
      accrued: string;
      available: string;
    }
  | {
      kind: "stake";
      asset: string;
      rewardAsset: string;
      apyBps: number;
      windowSeconds: number;
      available: string;
    }
  | {
      kind: "unstake";
      positionId: string;
      asset: string;
      principal: string;
      accrued: string;
    }
  | {
      kind: "claim";
      positionId: string;
      asset: string;
      accrued: string;
      windows: number;
    };

/** USD price for an asset. USDT is the quote unit (1.00); others are
 * computed from the `<ASSET>/USDT` market last price, or the inverse of a
 * `USDT/<ASSET>` market. USDC falls back to a 1.00 peg only when no market
 * is listed. Returns null if not derivable. */
function priceInUsd(asset: string, markets: Market[]): number | null {
  if (asset === "USDT") return 1;
  const direct = markets.find(
    (m) => m.base === asset && m.quote === "USDT" && m.last,
  );
  if (direct?.last) {
    const n = Number(direct.last);
    if (Number.isFinite(n) && n > 0) return n;
  }
  const inverse = markets.find(
    (m) => m.base === "USDT" && m.quote === asset && m.last,
  );
  if (inverse?.last) {
    const n = Number(inverse.last);
    if (Number.isFinite(n) && n > 0) return 1 / n;
  }
  if (asset === "USDC") return 1;
  return null;
}

function usd(value: number | null): string {
  if (value === null) return "$—";
  if (value === 0) return "$0.00";
  return `$${value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export default function EarnPage() {
  return (
    <Suspense fallback={<EarnFallback />}>
      <EarnPageInner />
    </Suspense>
  );
}

function EarnFallback() {
  return (
    <Container className="py-8 max-w-7xl">
      <h1 className="text-2xl font-semibold tracking-tight text-text">Earn</h1>
      <p className="text-sm text-text-dim mt-1 mb-6">Loading…</p>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-28 w-full" />
      </div>
      <Skeleton className="h-72 w-full" />
    </Container>
  );
}

function EarnPageInner() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const initialTab: TabKey =
    searchParams.get("tab") === "staking" ? "staking" : "lending";
  const [tab, setTab] = useState<TabKey>(initialTab);

  useEffect(() => {
    const next = searchParams.get("tab") === "staking" ? "staking" : "lending";
    setTab(next);
  }, [searchParams]);

  function switchTab(next: TabKey) {
    setTab(next);
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", next);
    // Typed routes can't statically verify a runtime-built querystring,
    // so we narrow through Route<string>. This is the documented escape
    // for known-safe dynamic URLs.
    router.replace(`${pathname}?${params.toString()}` as Route);
  }

  const [me, setMe] = useState<Me | null>(null);
  const [authed, setAuthed] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(true);

  const [pools, setPools] = useState<Pool[]>([]);
  const [lendingPositions, setLendingPositions] = useState<LendingPosition[]>(
    [],
  );
  const [programs, setPrograms] = useState<StakingProgram[]>([]);
  const [stakingPositions, setStakingPositions] = useState<StakingPosition[]>(
    [],
  );
  const [balances, setBalances] = useState<Balance[]>([]);
  const [markets, setMarkets] = useState<Market[]>([]);
  const [toast, setToast] = useState<ToastState>(null);
  const [modal, setModal] = useState<ModalState>({ kind: "none" });

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      await loadAllInner();
    } catch {
      setToast({ kind: "err", text: "Could not load Earn data. Please retry." });
    } finally {
      setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadAllInner() {
    // Public data first — does not require auth.
    const [poolsRes, programsRes, marketsRes] = await Promise.all([
      fetch("/api/v2/public/lending/pools"),
      fetch("/api/v2/public/staking/programs"),
      fetch("/api/v2/public/markets"),
    ]);
    if (poolsRes.ok) {
      const b = (await poolsRes.json()) as { pools: Pool[] };
      setPools(b.pools);
    }
    if (programsRes.ok) {
      const b = (await programsRes.json()) as { programs: StakingProgram[] };
      setPrograms(b.programs);
    }
    if (marketsRes.ok) {
      const b = (await marketsRes.json()) as { markets: Market[] };
      setMarkets(b.markets);
    }

    // Auth check
    const meRes = await authedFetch("/api/v2/me");
    if (meRes.status === 401) {
      setAuthed(false);
      return;
    }
    setAuthed(true);
    if (meRes.ok) {
      const b = (await meRes.json()) as Me;
      setMe(b);
    }

    const [balRes, lendRes, stakeRes] = await Promise.all([
      authedFetch("/api/v2/me/balance"),
      authedFetch("/api/v2/me/lending/positions"),
      authedFetch("/api/v2/me/staking/positions"),
    ]);
    if (balRes.ok) {
      const b = (await balRes.json()) as { balances: Balance[] };
      setBalances(b.balances);
    }
    if (lendRes.ok) {
      const b = (await lendRes.json()) as { positions: LendingPosition[] };
      setLendingPositions(b.positions);
    }
    if (stakeRes.ok) {
      const b = (await stakeRes.json()) as { positions: StakingPosition[] };
      setStakingPositions(b.positions);
    }
  }

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const availableFor = useCallback(
    (asset: string): string => {
      const b = balances.find((x) => x.asset === asset);
      return b?.available ?? "0";
    },
    [balances],
  );

  const tierOk = me ? me.kycTier >= EARN_TIER_REQUIRED : false;

  // Compute top-row stats from current state.
  const stats = useMemo(() => {
    const supplyPositions = lendingPositions.filter((p) => p.side === "supply");

    let totalValueUsd = 0;
    let totalAccruedUsd = 0;
    let weightedApyNumerator = 0;
    let weightedApyDenominator = 0;
    let positionCount = 0;
    let anyPriceMissing = false;

    for (const p of supplyPositions) {
      const price = priceInUsd(p.pool, markets);
      const principalNum = Number(p.principal);
      const accruedNum = Number(p.accrued);
      if (price === null) {
        anyPriceMissing = true;
        continue;
      }
      const valueUsd = (principalNum + accruedNum) * price;
      const accruedUsd = accruedNum * price;
      totalValueUsd += valueUsd;
      totalAccruedUsd += accruedUsd;
      positionCount += 1;
      const poolMeta = pools.find((x) => x.asset === p.pool);
      const apyBps = poolMeta?.effectiveApyBps ?? 0;
      weightedApyNumerator += (apyBps / 100) * valueUsd;
      weightedApyDenominator += valueUsd;
    }

    for (const p of stakingPositions) {
      const price = priceInUsd(p.asset, markets);
      const principalNum = Number(p.principal);
      const accruedNum = Number(p.accrued);
      if (price === null) {
        anyPriceMissing = true;
        continue;
      }
      const valueUsd = (principalNum + accruedNum) * price;
      const accruedUsd = accruedNum * price;
      totalValueUsd += valueUsd;
      totalAccruedUsd += accruedUsd;
      positionCount += 1;
      const program = programs.find((x) => x.asset === p.asset);
      const apyBps = program?.apyBps ?? 0;
      weightedApyNumerator += (apyBps / 100) * valueUsd;
      weightedApyDenominator += valueUsd;
    }

    const avgApy =
      weightedApyDenominator > 0
        ? weightedApyNumerator / weightedApyDenominator
        : null;

    return {
      totalValueUsd: positionCount === 0 ? 0 : totalValueUsd,
      totalAccruedUsd: positionCount === 0 ? 0 : totalAccruedUsd,
      avgApy,
      positionCount,
      anyPriceMissing: positionCount > 0 && anyPriceMissing,
    };
  }, [lendingPositions, stakingPositions, markets, pools, programs]);

  // Build collateral options for borrow modal: non-zero balances.
  const collateralOptions: BorrowAvailableAsset[] = useMemo(
    () =>
      balances
        .filter((b) => Number(b.available) > 0)
        .map((b) => ({ asset: b.asset, available: b.available })),
    [balances],
  );

  const closeModal = useCallback(() => setModal({ kind: "none" }), []);
  const onMutationSuccess = useCallback(() => {
    setToast({ kind: "ok", text: "Done. Refreshing…" });
    void loadAll();
    // Clear toast shortly after refresh
    setTimeout(() => setToast(null), 2500);
  }, [loadAll]);

  // ─────────────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────────────

  if (loading) {
    return <EarnFallback />;
  }

  if (!authed) {
    return (
      <Container className="py-10 max-w-4xl">
        <h1 className="text-2xl font-semibold tracking-tight text-text mb-2">
          Earn
        </h1>
        <p className="text-sm text-text-dim mb-8">
          Supply liquidity to lending pools or stake assets to earn APY.
        </p>
        <div className="rounded-lg border border-border bg-bg-elevated">
          <EmptyState
            title="Sign in to view your earnings"
            description="You need an account to supply, borrow, stake, or claim rewards."
            action={{ label: "Sign in →", href: "/login?next=/earn" }}
          />
        </div>
      </Container>
    );
  }

  const supplyPositions = lendingPositions.filter((p) => p.side === "supply");
  const borrowPositions = lendingPositions.filter((p) => p.side === "borrow");
  const actionDisabled = !tierOk;
  const actionTooltip = !tierOk
    ? `KYC Tier ${EARN_TIER_REQUIRED} required`
    : undefined;

  return (
    <Container className="py-8 max-w-7xl">
      {/* Header + tabs */}
      <div className="flex items-end justify-between gap-4 mb-6 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-text">
            Earn
          </h1>
          <p className="text-sm text-text-dim mt-1">
            Supply liquidity or stake assets to earn passive yield.
          </p>
        </div>
        <nav
          className="flex items-center gap-1 border-b border-border-subtle"
          role="tablist"
        >
          <TabButton
            label="Lending"
            active={tab === "lending"}
            onClick={() => switchTab("lending")}
          />
          <TabButton
            label="Staking"
            active={tab === "staking"}
            onClick={() => switchTab("staking")}
          />
        </nav>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <StatCard
          label="Total earning"
          value={
            stats.positionCount === 0
              ? "$0.00"
              : stats.anyPriceMissing
                ? "$—"
                : usd(stats.totalValueUsd)
          }
          hint={
            <span className="text-text-mute">
              across {stats.positionCount} position
              {stats.positionCount === 1 ? "" : "s"}
            </span>
          }
        />
        <StatCard
          label="Accrued"
          value={
            <span className="text-buy">
              {stats.positionCount === 0
                ? "+$0.00"
                : stats.anyPriceMissing
                  ? "$—"
                  : `+${usd(stats.totalAccruedUsd)}`}
            </span>
          }
          hint={<span className="text-text-mute">unclaimed</span>}
        />
        <StatCard
          label="Avg APY"
          value={stats.avgApy === null ? "—" : `${stats.avgApy.toFixed(2)}%`}
          hint={<span className="text-text-mute">weighted by value</span>}
        />
      </div>

      {/* Tier banner */}
      {me && !tierOk && (
        <div className="mb-6 rounded-lg border border-warn/40 bg-warn/10 px-4 py-3 flex items-start justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-warn">
              Verify your identity to start earning
            </p>
            <p className="text-xs text-text-dim mt-1">
              Lending and staking require KYC Tier {EARN_TIER_REQUIRED}+. Your
              account is currently Tier {me.kycTier}.
            </p>
          </div>
          <Link
            href="/account/kyc"
            className="shrink-0 inline-flex items-center justify-center h-9 px-4 text-sm font-semibold rounded-md bg-warn text-bg hover:bg-warn/90 transition-colors"
          >
            Verify identity →
          </Link>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div
          role="status"
          className={cn(
            "mb-6 rounded-md border px-4 py-2 text-sm",
            toast.kind === "ok"
              ? "border-buy/30 bg-buy/10 text-buy"
              : "border-sell/30 bg-sell/10 text-sell",
          )}
        >
          {toast.text}
        </div>
      )}

      {/* Tab content */}
      {tab === "lending" ? (
        <LendingTab
          supplyPositions={supplyPositions}
          borrowPositions={borrowPositions}
          pools={pools}
          actionDisabled={actionDisabled}
          actionTooltip={actionTooltip}
          availableFor={availableFor}
          onSupply={(asset, apyBps) =>
            setModal({
              kind: "supply",
              asset,
              apyBps,
              available: availableFor(asset),
            })
          }
          onBorrow={(asset, apyBps) =>
            setModal({
              kind: "borrow",
              asset,
              apyBps,
              collateralOptions,
            })
          }
          onWithdraw={(p) =>
            setModal({
              kind: "withdraw",
              positionId: p.id,
              asset: p.pool,
              principal: p.principal,
              accrued: p.accrued,
            })
          }
          onRepay={(p) =>
            setModal({
              kind: "repay",
              positionId: p.id,
              asset: p.pool,
              principal: p.principal,
              accrued: p.accrued,
              available: availableFor(p.pool),
            })
          }
          onAddToSupply={(p) =>
            setModal({
              kind: "supply",
              asset: p.pool,
              apyBps:
                pools.find((pl) => pl.asset === p.pool)?.effectiveApyBps ?? 0,
              available: availableFor(p.pool),
            })
          }
        />
      ) : (
        <StakingTab
          positions={stakingPositions}
          programs={programs}
          actionDisabled={actionDisabled}
          actionTooltip={actionTooltip}
          availableFor={availableFor}
          onStake={(prog) =>
            setModal({
              kind: "stake",
              asset: prog.asset,
              rewardAsset: prog.rewardAsset,
              apyBps: prog.apyBps,
              windowSeconds: prog.windowSeconds,
              available: availableFor(prog.asset),
            })
          }
          onClaim={(p) =>
            setModal({
              kind: "claim",
              positionId: p.id,
              asset: p.asset,
              accrued: p.accrued,
              windows: p.accruedWindows,
            })
          }
          onUnstake={(p) =>
            setModal({
              kind: "unstake",
              positionId: p.id,
              asset: p.asset,
              principal: p.principal,
              accrued: p.accrued,
            })
          }
        />
      )}

      {/* Modals */}
      <SupplyModal
        open={modal.kind === "supply"}
        onClose={closeModal}
        onSuccess={onMutationSuccess}
        asset={modal.kind === "supply" ? modal.asset : ""}
        available={modal.kind === "supply" ? modal.available : "0"}
        apyBps={modal.kind === "supply" ? modal.apyBps : 0}
      />
      <WithdrawModal
        open={modal.kind === "withdraw"}
        onClose={closeModal}
        onSuccess={onMutationSuccess}
        positionId={modal.kind === "withdraw" ? modal.positionId : ""}
        asset={modal.kind === "withdraw" ? modal.asset : ""}
        principal={modal.kind === "withdraw" ? modal.principal : "0"}
        accrued={modal.kind === "withdraw" ? modal.accrued : "0"}
      />
      <BorrowModal
        open={modal.kind === "borrow"}
        onClose={closeModal}
        onSuccess={onMutationSuccess}
        asset={modal.kind === "borrow" ? modal.asset : ""}
        apyBps={modal.kind === "borrow" ? modal.apyBps : 0}
        collateralOptions={
          modal.kind === "borrow" ? modal.collateralOptions : []
        }
        priceInUsd={(a) => priceInUsd(a, markets)}
      />
      <RepayModal
        open={modal.kind === "repay"}
        onClose={closeModal}
        onSuccess={onMutationSuccess}
        positionId={modal.kind === "repay" ? modal.positionId : ""}
        asset={modal.kind === "repay" ? modal.asset : ""}
        principal={modal.kind === "repay" ? modal.principal : "0"}
        accrued={modal.kind === "repay" ? modal.accrued : "0"}
        available={modal.kind === "repay" ? modal.available : "0"}
      />
      <StakeModal
        open={modal.kind === "stake"}
        onClose={closeModal}
        onSuccess={onMutationSuccess}
        asset={modal.kind === "stake" ? modal.asset : ""}
        rewardAsset={modal.kind === "stake" ? modal.rewardAsset : ""}
        apyBps={modal.kind === "stake" ? modal.apyBps : 0}
        windowSeconds={modal.kind === "stake" ? modal.windowSeconds : 0}
        available={modal.kind === "stake" ? modal.available : "0"}
      />
      <UnstakeModal
        open={modal.kind === "unstake"}
        onClose={closeModal}
        onSuccess={onMutationSuccess}
        positionId={modal.kind === "unstake" ? modal.positionId : ""}
        asset={modal.kind === "unstake" ? modal.asset : ""}
        principal={modal.kind === "unstake" ? modal.principal : "0"}
        accrued={modal.kind === "unstake" ? modal.accrued : "0"}
      />
      <ClaimModal
        open={modal.kind === "claim"}
        onClose={closeModal}
        onSuccess={onMutationSuccess}
        positionId={modal.kind === "claim" ? modal.positionId : ""}
        asset={modal.kind === "claim" ? modal.asset : ""}
        accrued={modal.kind === "claim" ? modal.accrued : "0"}
        windows={modal.kind === "claim" ? modal.windows : 0}
      />
    </Container>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Tab content
// ─────────────────────────────────────────────────────────────────────────

function TabButton({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        "px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors",
        active
          ? "text-accent border-accent"
          : "text-text-dim border-transparent hover:text-text",
      )}
    >
      {label}
    </button>
  );
}

interface LendingTabProps {
  supplyPositions: LendingPosition[];
  borrowPositions: LendingPosition[];
  pools: Pool[];
  actionDisabled: boolean;
  actionTooltip: string | undefined;
  availableFor: (asset: string) => string;
  onSupply: (asset: string, apyBps: number) => void;
  onBorrow: (asset: string, apyBps: number) => void;
  onWithdraw: (p: LendingPosition) => void;
  onRepay: (p: LendingPosition) => void;
  onAddToSupply: (p: LendingPosition) => void;
}

function LendingTab({
  supplyPositions,
  borrowPositions,
  pools,
  actionDisabled,
  actionTooltip,
  availableFor,
  onSupply,
  onBorrow,
  onWithdraw,
  onRepay,
  onAddToSupply,
}: LendingTabProps) {
  const supplyCols: Column<LendingPosition>[] = [
    {
      key: "asset",
      header: "Asset",
      render: (p) => <span className="font-medium">{p.pool}</span>,
    },
    {
      key: "apy",
      header: "Pool APY",
      align: "right",
      render: (p) => {
        const pool = pools.find((pl) => pl.asset === p.pool);
        return (
          <NumberCell
            value={(pool?.effectiveApyBps ?? 0) / 100}
            dp={2}
            suffix="%"
          />
        );
      },
    },
    {
      key: "supplied",
      header: "Supplied",
      align: "right",
      render: (p) => <NumberCell value={p.principal} />,
    },
    {
      key: "accrued",
      header: "Accrued",
      align: "right",
      render: (p) => (
        <span className="text-buy">
          <NumberCell value={p.accrued} prefix="+" className="text-buy" />
        </span>
      ),
    },
    {
      key: "total",
      header: "Total",
      align: "right",
      render: (p) => (
        <NumberCell
          value={Number(p.principal) + Number(p.accrued)}
          className="font-semibold"
        />
      ),
    },
    {
      key: "status",
      header: "Status",
      align: "center",
      render: () => (
        <span className="text-xs text-buy px-2 py-0.5 rounded bg-buy/10 border border-buy/20">
          active
        </span>
      ),
    },
    {
      key: "action",
      header: "Action",
      align: "right",
      render: (p) => (
        <div className="flex justify-end gap-2">
          <button
            type="button"
            disabled={actionDisabled}
            title={actionTooltip ?? "Add to position"}
            onClick={() => onAddToSupply(p)}
            className="text-xs text-text-dim hover:text-accent disabled:opacity-40 disabled:cursor-not-allowed underline"
          >
            Add ↗
          </button>
          <button
            type="button"
            disabled={actionDisabled}
            title={actionTooltip ?? "Withdraw position"}
            onClick={() => onWithdraw(p)}
            className="text-xs text-text-dim hover:text-accent disabled:opacity-40 disabled:cursor-not-allowed underline"
          >
            Withdraw ↗
          </button>
        </div>
      ),
    },
  ];

  const borrowCols: Column<LendingPosition>[] = [
    {
      key: "asset",
      header: "Asset",
      render: (p) => <span className="font-medium">{p.pool}</span>,
    },
    {
      key: "apy",
      header: "Pool APY",
      align: "right",
      render: (p) => {
        const pool = pools.find((pl) => pl.asset === p.pool);
        return (
          <NumberCell
            value={(pool?.effectiveApyBps ?? 0) / 100}
            dp={2}
            suffix="%"
          />
        );
      },
    },
    {
      key: "borrowed",
      header: "Borrowed",
      align: "right",
      render: (p) => <NumberCell value={p.principal} />,
    },
    {
      key: "accrued",
      header: "Accrued",
      align: "right",
      render: (p) => <NumberCell value={p.accrued} />,
    },
    {
      key: "total",
      header: "Total owed",
      align: "right",
      render: (p) => (
        <NumberCell
          value={Number(p.principal) + Number(p.accrued)}
          className="font-semibold"
        />
      ),
    },
    {
      key: "status",
      header: "Status",
      align: "center",
      render: () => (
        <span className="text-xs text-warn px-2 py-0.5 rounded bg-warn/10 border border-warn/20">
          borrowing
        </span>
      ),
    },
    {
      key: "action",
      header: "Action",
      align: "right",
      render: (p) => (
        <button
          type="button"
          disabled={actionDisabled}
          title={actionTooltip ?? "Repay borrow"}
          onClick={() => onRepay(p)}
          className="text-xs text-text-dim hover:text-accent disabled:opacity-40 disabled:cursor-not-allowed underline"
        >
          Repay ↗
        </button>
      ),
    },
  ];

  type PoolRow = Pool;
  const poolCols: Column<PoolRow>[] = [
    {
      key: "pool",
      header: "Pool",
      render: (p) => <span className="font-medium">{p.asset}</span>,
    },
    {
      key: "apy",
      header: "APY",
      align: "right",
      render: (p) => (
        <NumberCell value={p.effectiveApyBps / 100} dp={2} suffix="%" />
      ),
    },
    {
      key: "util",
      header: "Utilization",
      align: "right",
      render: (p) => (
        <NumberCell value={Number(p.utilization) * 100} dp={2} suffix="%" />
      ),
    },
    {
      key: "supplied",
      header: "Total supplied",
      align: "right",
      render: (p) => <NumberCell value={p.supplied} />,
    },
    {
      key: "borrowed",
      header: "Total borrowed",
      align: "right",
      render: (p) => <NumberCell value={p.borrowed} />,
    },
    {
      key: "available",
      header: "Your available",
      align: "right",
      render: (p) => {
        const avail = availableFor(p.asset);
        return Number(avail) > 0 ? (
          <BalancePill value={avail} asset={p.asset} label="" />
        ) : (
          <span className="text-text-mute text-xs">—</span>
        );
      },
    },
    {
      key: "action",
      header: "Action",
      align: "right",
      render: (p) => {
        const avail = availableFor(p.asset);
        const hasBalance = Number(avail) > 0;
        const supplyDisabled = actionDisabled || !hasBalance;
        return (
          <div className="flex justify-end gap-2">
            <button
              type="button"
              disabled={supplyDisabled}
              title={
                actionTooltip ??
                (!hasBalance ? `No ${p.asset} available` : `Supply ${p.asset}`)
              }
              onClick={() => onSupply(p.asset, p.effectiveApyBps)}
              className="text-xs text-text-dim hover:text-accent disabled:opacity-40 disabled:cursor-not-allowed underline"
            >
              Supply ↗
            </button>
            <button
              type="button"
              disabled={actionDisabled}
              title={actionTooltip ?? `Borrow ${p.asset}`}
              onClick={() => onBorrow(p.asset, p.effectiveApyBps)}
              className="text-xs text-text-dim hover:text-accent disabled:opacity-40 disabled:cursor-not-allowed underline"
            >
              Borrow ↗
            </button>
          </div>
        );
      },
    },
  ];

  return (
    <div className="space-y-6">
      <section>
        <h2 className="text-sm font-semibold text-text mb-2 uppercase tracking-wider">
          Your supply positions
        </h2>
        <DataTable
          columns={supplyCols}
          rows={supplyPositions}
          rowKey={(p) => p.id}
          empty={
            <EmptyState
              title="You're not supplying anything yet"
              description="Open a supply position from the available pools below to start earning interest."
            />
          }
        />
      </section>

      <section>
        <h2 className="text-sm font-semibold text-text mb-2 uppercase tracking-wider">
          Your borrow positions
        </h2>
        <DataTable
          columns={borrowCols}
          rows={borrowPositions}
          rowKey={(p) => p.id}
          empty={
            <EmptyState
              title="You have no open borrow positions"
              description="Borrow against collateral from any pool below."
            />
          }
        />
      </section>

      <section>
        <h2 className="text-sm font-semibold text-text mb-2 uppercase tracking-wider">
          Available pools
        </h2>
        <DataTable
          columns={poolCols}
          rows={pools}
          rowKey={(p) => p.asset}
          empty={<span>No pools available.</span>}
        />
      </section>
    </div>
  );
}

interface StakingTabProps {
  positions: StakingPosition[];
  programs: StakingProgram[];
  actionDisabled: boolean;
  actionTooltip: string | undefined;
  availableFor: (asset: string) => string;
  onStake: (prog: StakingProgram) => void;
  onClaim: (p: StakingPosition) => void;
  onUnstake: (p: StakingPosition) => void;
}

function StakingTab({
  positions,
  programs,
  actionDisabled,
  actionTooltip,
  availableFor,
  onStake,
  onClaim,
  onUnstake,
}: StakingTabProps) {
  const stakeCols: Column<StakingPosition>[] = [
    {
      key: "asset",
      header: "Asset",
      render: (p) => <span className="font-medium">{p.asset}</span>,
    },
    {
      key: "apy",
      header: "Program APY",
      align: "right",
      render: (p) => {
        const prog = programs.find((x) => x.asset === p.asset);
        return prog ? (
          <NumberCell value={prog.apyBps / 100} dp={2} suffix="%" />
        ) : (
          <span className="text-text-mute">—</span>
        );
      },
    },
    {
      key: "staked",
      header: "Staked",
      align: "right",
      render: (p) => <NumberCell value={p.principal} />,
    },
    {
      key: "accrued",
      header: "Accrued",
      align: "right",
      render: (p) => (
        <NumberCell value={p.accrued} prefix="+" className="text-buy" />
      ),
    },
    {
      key: "windows",
      header: "Windows",
      align: "right",
      render: (p) => <NumberCell value={p.accruedWindows} />,
    },
    {
      key: "status",
      header: "Status",
      align: "center",
      render: (p) => {
        const cls =
          p.status === "active"
            ? "text-buy bg-buy/10 border-buy/20"
            : p.status === "unstaking"
              ? "text-warn bg-warn/10 border-warn/20"
              : "text-text-mute bg-bg border-border";
        return (
          <span
            className={cn(
              "text-xs px-2 py-0.5 rounded border inline-block",
              cls,
            )}
          >
            {p.status}
          </span>
        );
      },
    },
    {
      key: "action",
      header: "Action",
      align: "right",
      render: (p) => {
        // Ended positions keep their unclaimed rewards claimable, even
        // though no new windows accrue.
        const claimDisabled =
          actionDisabled ||
          Number(p.accrued) <= 0 ||
          (p.status === "active" && p.accruedWindows === 0);
        const unstakeDisabled = actionDisabled || p.status !== "active";
        return (
          <div className="flex justify-end gap-2">
            <button
              type="button"
              disabled={claimDisabled}
              title={
                actionTooltip ??
                (Number(p.accrued) <= 0
                  ? "No rewards yet"
                  : `Claim ${formatDecimal(p.accrued)} ${p.asset}`)
              }
              onClick={() => onClaim(p)}
              className="text-xs text-text-dim hover:text-accent disabled:opacity-40 disabled:cursor-not-allowed underline"
            >
              Claim
            </button>
            <button
              type="button"
              disabled={unstakeDisabled}
              title={
                actionTooltip ??
                (p.status !== "active"
                  ? "Position is not active"
                  : "Unstake position")
              }
              onClick={() => onUnstake(p)}
              className="text-xs text-text-dim hover:text-accent disabled:opacity-40 disabled:cursor-not-allowed underline"
            >
              Unstake
            </button>
          </div>
        );
      },
    },
  ];

  const programCols: Column<StakingProgram>[] = [
    {
      key: "asset",
      header: "Asset",
      render: (p) => <span className="font-medium">{p.asset}</span>,
    },
    {
      key: "reward",
      header: "Reward",
      align: "center",
      render: (p) => <span className="text-text-dim">{p.rewardAsset}</span>,
    },
    {
      key: "apy",
      header: "APY",
      align: "right",
      render: (p) => <NumberCell value={p.apyBps / 100} dp={2} suffix="%" />,
    },
    {
      key: "window",
      header: "Window",
      align: "right",
      render: (p) => <NumberCell value={p.windowSeconds} suffix="s" />,
    },
    {
      key: "available",
      header: "Your available",
      align: "right",
      render: (p) => {
        const avail = availableFor(p.asset);
        return Number(avail) > 0 ? (
          <BalancePill value={avail} asset={p.asset} label="" />
        ) : (
          <span className="text-text-mute text-xs">—</span>
        );
      },
    },
    {
      key: "action",
      header: "Action",
      align: "right",
      render: (p) => {
        const avail = availableFor(p.asset);
        const hasBalance = Number(avail) > 0;
        const stakeDisabled = actionDisabled || !hasBalance;
        return (
          <button
            type="button"
            disabled={stakeDisabled}
            title={
              actionTooltip ??
              (!hasBalance
                ? `No ${p.asset} available. Deposit or buy first.`
                : `Stake ${p.asset}`)
            }
            onClick={() => onStake(p)}
            className="text-xs text-text-dim hover:text-accent disabled:opacity-40 disabled:cursor-not-allowed underline"
          >
            Stake ↗
          </button>
        );
      },
    },
  ];

  return (
    <div className="space-y-6">
      <section>
        <h2 className="text-sm font-semibold text-text mb-2 uppercase tracking-wider">
          Your stakes
        </h2>
        <DataTable
          columns={stakeCols}
          rows={positions}
          rowKey={(p) => p.id}
          empty={
            <EmptyState
              title="You're not staking anything yet"
              description="Pick a program below to start earning APY."
            />
          }
        />
      </section>

      <section>
        <h2 className="text-sm font-semibold text-text mb-2 uppercase tracking-wider">
          Available programs
        </h2>
        <DataTable
          columns={programCols}
          rows={programs}
          rowKey={(p) => p.id}
          empty={<span>No programs available.</span>}
        />
      </section>
    </div>
  );
}
