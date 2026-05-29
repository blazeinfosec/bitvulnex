// Phase 10 slice 5 — single round-trip aggregate for the portfolio
// dashboard. Read-only. The handler doesn't touch any planted-vuln
// surface; it just stitches together the same data the per-feature
// endpoints already expose.

import { NextResponse } from "next/server";
import { Prisma, prisma } from "@bvbe/db";
import { userFromAuthorization } from "@/lib/auth";
import { jsonError } from "@/lib/api";
import { registerEndpoint } from "@/lib/openapi-registry";
import { requireTier, TierError } from "@/lib/kyc-tier";
import {
  buildActivityFeed,
  type ActivityInput,
} from "@/lib/portfolio/activity";

registerEndpoint({
  method: "get",
  path: "/api/v2/me/dashboard",
  summary:
    "Single-call aggregate for the portfolio dashboard (totals, balances, equity curve, counts, activity, onboarding)",
  responses: {
    "200": { description: "Dashboard payload" },
    "401": { description: "Auth required" },
    "403": { description: "KYC tier insufficient" },
  },
});

export const dynamic = "force-dynamic";

const D = (v: Prisma.Decimal | string | number) => new Prisma.Decimal(v);

type PriceFn = (asset: string) => Promise<Prisma.Decimal>;

function makePriceCache(): PriceFn {
  const cache = new Map<string, Prisma.Decimal>();
  cache.set("USDT", D("1"));
  cache.set("USDC", D("1"));
  return async (asset: string) => {
    const hit = cache.get(asset);
    if (hit) return hit;
    const t = await prisma.trade.findFirst({
      where: { pair: `${asset}/USDT` },
      orderBy: { executedAt: "desc" },
      select: { price: true },
    });
    const p = t ? D(t.price) : D("0");
    cache.set(asset, p);
    return p;
  };
}

function tierRequirements(user: {
  kycTier: number;
  emailVerified: boolean;
}): { next: number | null; requirements: string[] } {
  const reqs: string[] = [];
  if (!user.emailVerified) reqs.push("Verify your email address");
  let next: number | null;
  if (user.kycTier >= 3) {
    next = null;
  } else {
    next = user.kycTier + 1;
    if (next === 1) reqs.push("Submit basic identity info (Tier 1 KYC)");
    if (next === 2) reqs.push("Upload an ID document (Tier 2 KYC)");
    if (next === 3) reqs.push("Submit proof of address (Tier 3 KYC)");
  }
  return { next, requirements: reqs };
}

export async function GET(req: Request) {
  const claims = await userFromAuthorization(req.headers.get("authorization"));
  if (!claims) return jsonError(401, "unauthorized");

  try {
    requireTier(claims, 1);
  } catch (e) {
    if (e instanceof TierError) {
      return jsonError(403, e.message, "TIER");
    }
    throw e;
  }

  const userId = claims.sub;

  // Run all the independent reads in parallel. None of these mutate;
  // all are scoped to the caller's userId, so this doesn't widen the
  // scope of any planted IDOR (those live in surfaces with an :id
  // path segment).
  const [
    user,
    balances,
    snapshots,
    openOrders,
    openMargin,
    lendingPositions,
    stakingPositions,
    deposits,
    withdrawals,
    transfersOut,
    transfersIn,
    tradesAsTaker,
    tradesAsMaker,
    recentOrders,
    otcFills,
    p2pBuys,
    p2pSells,
    firstDeposit,
    firstTrade,
  ] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        displayName: true,
        role: true,
        kycTier: true,
        emailVerified: true,
        totpEnabled: true,
        createdAt: true,
      },
    }),
    prisma.balance.findMany({
      where: { userId },
      select: {
        asset: true,
        amount: true,
        available: true,
        locked: true,
        marginAvailable: true,
        marginBorrowed: true,
      },
    }),
    prisma.equitySnapshot.findMany({
      where: { userId },
      orderBy: { date: "asc" },
      take: 30,
      select: { date: true, totalUsd: true },
    }),
    prisma.order.findMany({
      where: { userId, status: { in: ["open", "partial"] } },
      select: { id: true },
    }),
    prisma.marginPosition.findMany({
      where: { userId, status: "open" },
      select: { id: true },
    }),
    prisma.lendingPosition.findMany({
      where: { userId, status: "open" },
      select: {
        id: true,
        pool: true,
        side: true,
        principal: true,
        openedAt: true,
        closedAt: true,
      },
    }),
    prisma.stakingPosition.findMany({
      where: { userId, status: "active" },
      select: {
        id: true,
        asset: true,
        principal: true,
        startedAt: true,
        unstakedAt: true,
      },
    }),
    prisma.deposit.findMany({
      where: { userId, status: "credited" },
      orderBy: { creditedAt: "desc" },
      take: 30,
      select: {
        asset: true,
        amount: true,
        creditedAt: true,
        seenAt: true,
        status: true,
      },
    }),
    prisma.withdrawal.findMany({
      where: { userId },
      orderBy: { requestedAt: "desc" },
      take: 30,
      select: {
        asset: true,
        amount: true,
        requestedAt: true,
        status: true,
        destAddress: true,
      },
    }),
    prisma.internalTransfer.findMany({
      where: { fromUserId: userId },
      orderBy: { createdAt: "desc" },
      take: 30,
      select: {
        asset: true,
        amount: true,
        createdAt: true,
        toUser: { select: { email: true } },
      },
    }),
    prisma.internalTransfer.findMany({
      where: { toUserId: userId },
      orderBy: { createdAt: "desc" },
      take: 30,
      select: {
        asset: true,
        amount: true,
        createdAt: true,
        fromUser: { select: { email: true } },
      },
    }),
    prisma.trade.findMany({
      where: { takerUserId: userId },
      orderBy: { executedAt: "desc" },
      take: 50,
      select: {
        pair: true,
        amount: true,
        price: true,
        executedAt: true,
        takerOrder: { select: { side: true } },
      },
    }),
    prisma.trade.findMany({
      where: { makerUserId: userId },
      orderBy: { executedAt: "desc" },
      take: 50,
      select: {
        pair: true,
        amount: true,
        price: true,
        executedAt: true,
        makerOrder: { select: { side: true } },
      },
    }),
    prisma.order.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: {
        pair: true,
        side: true,
        type: true,
        amount: true,
        price: true,
        status: true,
        createdAt: true,
        cancelledAt: true,
      },
    }),
    prisma.otcTicket.findMany({
      where: { userId, status: "filled" },
      orderBy: { filledAt: "desc" },
      take: 20,
      select: {
        pair: true,
        side: true,
        amount: true,
        filledAt: true,
      },
    }),
    prisma.p2PTrade.findMany({
      where: { buyerUserId: userId, releasedAt: { not: null } },
      orderBy: { releasedAt: "desc" },
      take: 20,
      select: { asset: true, amount: true, releasedAt: true },
    }),
    prisma.p2PTrade.findMany({
      where: { sellerUserId: userId, releasedAt: { not: null } },
      orderBy: { releasedAt: "desc" },
      take: 20,
      select: { asset: true, amount: true, releasedAt: true },
    }),
    prisma.deposit.findFirst({
      where: { userId, status: "credited" },
      select: { id: true },
    }),
    prisma.trade.findFirst({
      where: { OR: [{ takerUserId: userId }, { makerUserId: userId }] },
      select: { id: true },
    }),
  ]);

  if (!user) return jsonError(401, "unauthorized");

  // Compute USD values for balances. Use the same price-from-USDT cache.
  const priceFor = makePriceCache();
  const balanceRows: Array<{
    asset: string;
    amount: string;
    available: string;
    locked: string;
    marginAvailable: string;
    marginBorrowed: string;
    usdValue: string;
  }> = [];
  let liveEquity = D("0");
  for (const b of balances) {
    const px = await priceFor(b.asset);
    const usd = D(b.amount).mul(px);
    const marginUsd = D(b.marginAvailable).mul(px);
    liveEquity = liveEquity.add(usd).add(marginUsd);
    balanceRows.push({
      asset: b.asset,
      amount: b.amount.toString(),
      available: b.available.toString(),
      locked: b.locked.toString(),
      marginAvailable: b.marginAvailable.toString(),
      marginBorrowed: b.marginBorrowed.toString(),
      usdValue: usd.toFixed(2),
    });
  }
  // Fold in lending / staking / margin position contributions for the
  // live equity number so it agrees with the snapshot worker.
  for (const lp of lendingPositions) {
    const px = await priceFor(lp.pool);
    if (px.lte(0)) continue;
    const value = D(lp.principal).mul(px);
    liveEquity =
      lp.side === "supply" ? liveEquity.add(value) : liveEquity.sub(value);
  }
  for (const sp of stakingPositions) {
    const px = await priceFor(sp.asset);
    if (px.lte(0)) continue;
    liveEquity = liveEquity.add(D(sp.principal).mul(px));
  }

  // 24h delta from snapshot history (use the most recent snapshot
  // older than ~24h, else fall back to the oldest available).
  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;
  let baseline: Prisma.Decimal | null = null;
  for (let i = snapshots.length - 1; i >= 0; i--) {
    const s = snapshots[i]!;
    if (now - s.date.getTime() >= dayMs - 1000) {
      baseline = D(s.totalUsd);
      break;
    }
  }
  if (!baseline && snapshots.length > 0) {
    baseline = D(snapshots[0]!.totalUsd);
  }
  const deltaUsd = baseline ? liveEquity.sub(baseline) : D("0");
  const deltaPct =
    baseline && baseline.abs().gt(0)
      ? Number(deltaUsd.div(baseline).mul(100).toFixed(2))
      : 0;

  // Equity snapshots out + a synthesized "today" point so the curve
  // moves visibly between worker ticks.
  const snapshotsOut = snapshots.map((s) => ({
    date: s.date.toISOString().slice(0, 10),
    totalUsd: s.totalUsd.toString(),
  }));
  const todayKey = new Date().toISOString().slice(0, 10);
  if (
    snapshotsOut.length === 0 ||
    snapshotsOut[snapshotsOut.length - 1]?.date !== todayKey
  ) {
    snapshotsOut.push({ date: todayKey, totalUsd: liveEquity.toFixed(8) });
  } else {
    snapshotsOut[snapshotsOut.length - 1]!.totalUsd = liveEquity.toFixed(8);
  }

  // Activity feed merge.
  const activityInput: ActivityInput = {
    deposits: deposits.map((d) => ({
      asset: d.asset,
      amount: d.amount.toString(),
      creditedAt: d.creditedAt,
      seenAt: d.seenAt,
      status: d.status,
    })),
    withdrawals: withdrawals.map((w) => ({
      asset: w.asset,
      amount: w.amount.toString(),
      requestedAt: w.requestedAt,
      status: w.status,
      destAddress: w.destAddress,
    })),
    transfers: [
      ...transfersOut.map((t) => ({
        asset: t.asset,
        amount: t.amount.toString(),
        createdAt: t.createdAt,
        direction: "out" as const,
        counterparty: t.toUser?.email ?? null,
      })),
      ...transfersIn.map((t) => ({
        asset: t.asset,
        amount: t.amount.toString(),
        createdAt: t.createdAt,
        direction: "in" as const,
        counterparty: t.fromUser?.email ?? null,
      })),
    ],
    trades: [
      ...tradesAsTaker.map((t) => ({
        pair: t.pair,
        amount: t.amount.toString(),
        price: t.price.toString(),
        executedAt: t.executedAt,
        side: t.takerOrder.side as "buy" | "sell",
      })),
      ...tradesAsMaker.map((t) => ({
        pair: t.pair,
        amount: t.amount.toString(),
        price: t.price.toString(),
        executedAt: t.executedAt,
        // Maker fills are the opposite side of the taker
        side:
          (t.makerOrder.side as "buy" | "sell") === "buy"
            ? ("buy" as const)
            : ("sell" as const),
      })),
    ],
    orders: recentOrders.map((o) => ({
      pair: o.pair,
      side: o.side as "buy" | "sell",
      type: o.type,
      amount: o.amount.toString(),
      price: o.price ? o.price.toString() : null,
      status: o.status,
      createdAt: o.createdAt,
      cancelledAt: o.cancelledAt,
    })),
    stakes: stakingPositions.map((s) => ({
      asset: s.asset,
      principal: s.principal.toString(),
      startedAt: s.startedAt,
      unstakedAt: s.unstakedAt,
    })),
    lending: lendingPositions.map((lp) => ({
      pool: lp.pool,
      side: lp.side as "supply" | "borrow",
      principal: lp.principal.toString(),
      openedAt: lp.openedAt,
      closedAt: lp.closedAt,
    })),
    otc: otcFills
      .filter((o) => o.filledAt !== null)
      .map((o) => ({
        pair: o.pair,
        side: o.side as "buy" | "sell",
        amount: o.amount.toString(),
        filledAt: o.filledAt as Date,
      })),
    p2p: [
      ...p2pBuys
        .filter((p) => p.releasedAt !== null)
        .map((p) => ({
          asset: p.asset,
          amount: p.amount.toString(),
          releasedAt: p.releasedAt as Date,
          role: "buyer" as const,
        })),
      ...p2pSells
        .filter((p) => p.releasedAt !== null)
        .map((p) => ({
          asset: p.asset,
          amount: p.amount.toString(),
          releasedAt: p.releasedAt as Date,
          role: "seller" as const,
        })),
    ],
  };
  const activity = buildActivityFeed(activityInput, 50);

  const { next: nextTier, requirements } = tierRequirements(user);

  const openLendingSupplies = lendingPositions.filter(
    (p) => p.side === "supply",
  ).length;
  const openLendingBorrows = lendingPositions.filter(
    (p) => p.side === "borrow",
  ).length;

  return NextResponse.json({
    user,
    totals: {
      equityUsd: liveEquity.toFixed(2),
      deltaUsd24h: deltaUsd.toFixed(2),
      deltaPct24h: deltaPct,
    },
    tier: {
      current: user.kycTier,
      next: nextTier,
      requirements,
    },
    equitySnapshots: snapshotsOut,
    balances: balanceRows,
    counts: {
      openOrders: openOrders.length,
      openPositions: openMargin.length,
      openLendingSupplies,
      openLendingBorrows,
      openStakes: stakingPositions.length,
    },
    activity,
    onboarding: {
      emailVerified: user.emailVerified,
      kycTier1Done: user.kycTier >= 1,
      firstDepositDone: Boolean(firstDeposit),
      firstTradeDone: Boolean(firstTrade),
      earnPositionOpen:
        lendingPositions.length > 0 || stakingPositions.length > 0,
    },
  });
}
