"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Container } from "@/components/ui/container";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { authedFetch } from "@/lib/token-storage";

type Program = {
  id: string;
  asset: string;
  rewardAsset: string;
  apyBps: number;
  windowSeconds: number;
};

type Balance = {
  asset: string;
  available: string;
  amount: string;
  locked: string;
};

type Position = {
  id: string;
  asset: string;
  principal: string;
  status: "active" | "unstaking" | "ended";
  startedAt: string;
  unstakedAt: string | null;
  accrued: string;
  accruedWindows: number;
};

type Me = {
  id: string;
  email: string;
  displayName: string | null;
  role: string;
  kycTier: number;
};

const STAKE_TIER_REQUIRED = 1;

function formatAmount(value: string, asset: string): string {
  const trimmed = value.replace(/\.?0+$/, "");
  return trimmed === "" || trimmed === "-" ? "0" : trimmed;
}

function pctOf(value: string, fraction: number): string {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return "0";
  return (n * fraction).toFixed(8).replace(/\.?0+$/, "");
}

export default function StakingPage() {
  const [programs, setPrograms] = useState<Program[]>([]);
  const [balances, setBalances] = useState<Balance[]>([]);
  const [positions, setPositions] = useState<Position[]>([]);
  const [me, setMe] = useState<Me | null>(null);
  const [authed, setAuthed] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(true);
  const [asset, setAsset] = useState("ETH");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const loadAll = useCallback(async () => {
    setLoading(true);
    const programsRes = await fetch("/api/v2/public/staking/programs");
    if (programsRes.ok) {
      const b = (await programsRes.json()) as { programs: Program[] };
      setPrograms(b.programs);
      if (b.programs[0]) setAsset((prev) => prev || b.programs[0]!.asset);
    }

    const meRes = await authedFetch("/api/v2/me");
    if (meRes.status === 401) {
      setAuthed(false);
      setLoading(false);
      return;
    }
    setAuthed(true);
    if (meRes.ok) {
      const b = (await meRes.json()) as Me;
      setMe(b);
    }

    const [balRes, posRes] = await Promise.all([
      authedFetch("/api/v2/me/balance"),
      authedFetch("/api/v2/me/staking/positions"),
    ]);
    if (balRes.ok) {
      const b = (await balRes.json()) as { balances: Balance[] };
      setBalances(b.balances);
    }
    if (posRes.ok) {
      const b = (await posRes.json()) as { positions: Position[] };
      setPositions(b.positions);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const availableFor = (a: string): string => {
    const b = balances.find((x) => x.asset === a);
    return b?.available ?? "0";
  };

  const tierOk = me ? me.kycTier >= STAKE_TIER_REQUIRED : false;
  const stakable = availableFor(asset);
  const amountNum = Number(amount);
  const stakableNum = Number(stakable);
  const amountValid =
    amount !== "" && Number.isFinite(amountNum) && amountNum > 0;
  const amountAffordable = amountValid && amountNum <= stakableNum;
  const canStake = authed && tierOk && amountAffordable && !busy;

  async function stake() {
    if (!canStake) return;
    setBusy(true);
    setMessage(null);
    const res = await authedFetch("/api/v2/me/staking/stake", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ asset, amount }),
    });
    if (res.ok) {
      setMessage({ kind: "ok", text: `Staked ${amount} ${asset}` });
      setAmount("");
      await loadAll();
    } else if (res.status === 403) {
      setMessage({
        kind: "err",
        text: `KYC Tier ${STAKE_TIER_REQUIRED} required to stake. Complete verification to continue.`,
      });
    } else {
      const body = await res.text();
      setMessage({ kind: "err", text: `Stake failed (${res.status}): ${body || "unknown error"}` });
    }
    setBusy(false);
  }

  async function unstake(positionId: string) {
    setBusy(true);
    setMessage(null);
    const res = await authedFetch("/api/v2/me/staking/unstake", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ positionId }),
    });
    if (res.ok) {
      setMessage({ kind: "ok", text: "Unstaked. Principal credited to spot balance." });
      await loadAll();
    } else {
      const body = await res.text();
      setMessage({ kind: "err", text: `Unstake failed (${res.status}): ${body || "unknown error"}` });
    }
    setBusy(false);
  }

  async function claim(positionId: string) {
    setBusy(true);
    setMessage(null);
    const res = await authedFetch("/api/v2/me/staking/claim", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ positionId }),
    });
    if (res.ok) {
      const b = (await res.json()) as { credited: string; rows: number };
      setMessage({
        kind: "ok",
        text: `Claimed ${b.credited} from ${b.rows} reward window${b.rows === 1 ? "" : "s"}.`,
      });
      await loadAll();
    } else if (res.status === 404) {
      setMessage({ kind: "err", text: "No unclaimed rewards yet. Check back after the next reward window." });
    } else {
      const body = await res.text();
      setMessage({ kind: "err", text: `Claim failed (${res.status}): ${body || "unknown error"}` });
    }
    setBusy(false);
  }

  if (loading) {
    return (
      <Container className="py-10 max-w-4xl">
        <p className="text-sm text-navy-600">Loading…</p>
      </Container>
    );
  }

  if (!authed) {
    return (
      <Container className="py-10 max-w-4xl">
        <h1 className="text-3xl font-semibold tracking-tight text-navy-900 mb-2">
          Staking
        </h1>
        <Card className="mt-6">
          <CardContent className="py-8 text-center space-y-3">
            <p className="text-navy-700">Sign in to stake assets and earn APY.</p>
            <Link
              href="/login?next=/staking"
              className="inline-block underline text-navy-900 font-medium"
            >
              Sign in →
            </Link>
          </CardContent>
        </Card>
      </Container>
    );
  }

  return (
    <Container className="py-10 max-w-4xl">
      <h1 className="text-3xl font-semibold tracking-tight text-navy-900 mb-1">
        Staking
      </h1>
      <p className="text-sm text-navy-600 mb-6">
        Earn fixed APY by staking PoS-style assets. Rewards materialize every
        program window and are credited on claim.
      </p>

      {/* Tier gate banner — shown proactively, no surprise 403s */}
      {me && !tierOk && (
        <Card className="mb-6 border-amber-300 bg-amber-50">
          <CardContent className="py-4 flex items-center justify-between gap-4">
            <div>
              <p className="font-medium text-amber-900">
                Verify your identity to start staking
              </p>
              <p className="text-sm text-amber-800">
                Your account is currently Tier {me.kycTier}. Staking requires KYC
                Tier {STAKE_TIER_REQUIRED}+. Complete verification — typically a few
                minutes.
              </p>
            </div>
            <Link
              href="/account/kyc"
              className="shrink-0 inline-block rounded-md bg-amber-900 text-amber-50 px-4 py-2 text-sm font-medium hover:bg-amber-800"
            >
              Verify identity →
            </Link>
          </CardContent>
        </Card>
      )}

      {message && (
        <div
          role="alert"
          className={
            message.kind === "ok"
              ? "mb-6 rounded-md border border-green-300 bg-green-50 text-green-900 px-4 py-3 text-sm"
              : "mb-6 rounded-md border border-red-300 bg-red-50 text-red-900 px-4 py-3 text-sm"
          }
        >
          {message.text}
        </div>
      )}

      {/* Your positions — what's staked, what's accrued */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Your positions</CardTitle>
        </CardHeader>
        <CardContent>
          {positions.length === 0 ? (
            <p className="text-sm text-navy-600 py-2">
              You have no staked assets yet. Stake some below to start earning.
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-xs uppercase tracking-wider text-navy-500">
                <tr>
                  <th className="text-left py-2">Asset</th>
                  <th className="text-right">Staked</th>
                  <th className="text-right">Accrued</th>
                  <th className="text-right">Windows</th>
                  <th className="text-right">Status</th>
                  <th className="text-right">Action</th>
                </tr>
              </thead>
              <tbody className="font-tabular">
                {positions.map((p) => (
                  <tr key={p.id} className="border-t border-navy-100">
                    <td className="py-2">{p.asset}</td>
                    <td className="text-right">{formatAmount(p.principal, p.asset)}</td>
                    <td className="text-right">
                      {formatAmount(p.accrued, p.asset)}
                    </td>
                    <td className="text-right">{p.accruedWindows}</td>
                    <td className="text-right text-navy-600">{p.status}</td>
                    <td className="text-right space-x-2">
                      <button
                        className="text-xs underline text-navy-700 hover:text-navy-900 disabled:opacity-40 disabled:cursor-not-allowed"
                        disabled={busy || Number(p.accrued) <= 0}
                        title={
                          Number(p.accrued) <= 0
                            ? "No unclaimed rewards yet"
                            : `Claim ${formatAmount(p.accrued, p.asset)} ${p.asset}`
                        }
                        onClick={() => void claim(p.id)}
                      >
                        Claim
                      </button>
                      <button
                        className="text-xs underline text-navy-700 hover:text-navy-900 disabled:opacity-40 disabled:cursor-not-allowed"
                        disabled={busy || p.status !== "active"}
                        title={
                          p.status === "active"
                            ? "Unstake and credit principal back to spot"
                            : "Position is not active"
                        }
                        onClick={() => void unstake(p.id)}
                      >
                        Unstake
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      {/* Programs table — APY + windows */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Available programs</CardTitle>
        </CardHeader>
        <CardContent>
          <table className="w-full text-sm">
            <thead className="text-xs uppercase tracking-wider text-navy-500">
              <tr>
                <th className="text-left py-2">Asset</th>
                <th>Reward</th>
                <th className="text-right">APY</th>
                <th className="text-right">Window</th>
                <th className="text-right">Your available</th>
              </tr>
            </thead>
            <tbody className="font-tabular">
              {programs.map((p) => (
                <tr key={p.asset} className="border-t border-navy-100">
                  <td className="py-2">{p.asset}</td>
                  <td className="text-center">{p.rewardAsset}</td>
                  <td className="text-right">{(p.apyBps / 100).toFixed(2)}%</td>
                  <td className="text-right">{p.windowSeconds}s</td>
                  <td className="text-right">
                    {formatAmount(availableFor(p.asset), p.asset)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {/* Stake form — with balance display + percent pills + disabled state */}
      <Card>
        <CardHeader>
          <CardTitle>Stake</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <label className="text-sm text-navy-700">
              Asset
              <select
                className="ml-2 border border-navy-200 rounded px-2 py-1 bg-white"
                value={asset}
                onChange={(e) => setAsset(e.target.value)}
              >
                {programs.map((p) => (
                  <option key={p.asset}>{p.asset}</option>
                ))}
              </select>
            </label>
            <div className="text-sm text-navy-700">
              Available:{" "}
              <span className="font-tabular font-medium">
                {formatAmount(stakable, asset)} {asset}
              </span>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <input
              className="border border-navy-200 rounded px-3 py-2 font-tabular w-44"
              placeholder="amount"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              disabled={!tierOk}
            />
            <div className="flex gap-1">
              {[0.25, 0.5, 0.75, 1].map((f) => (
                <button
                  key={f}
                  type="button"
                  className="text-xs px-2 py-1 rounded border border-navy-200 hover:bg-navy-50 disabled:opacity-40 disabled:cursor-not-allowed"
                  disabled={!tierOk || stakableNum <= 0}
                  onClick={() => setAmount(pctOf(stakable, f))}
                >
                  {f === 1 ? "MAX" : `${Math.round(f * 100)}%`}
                </button>
              ))}
            </div>
            <Button
              onClick={stake}
              disabled={!canStake}
              title={
                !tierOk
                  ? `KYC Tier ${STAKE_TIER_REQUIRED} required to stake`
                  : stakableNum <= 0
                    ? `No ${asset} available. Deposit ${asset} or buy on the spot market first.`
                    : !amountValid
                      ? "Enter an amount"
                      : !amountAffordable
                        ? `Insufficient ${asset}. Available: ${formatAmount(stakable, asset)}`
                        : `Stake ${amount} ${asset}`
              }
            >
              {busy ? "Staking…" : "Stake"}
            </Button>
          </div>

          {!tierOk && (
            <p className="text-xs text-navy-600">
              Complete KYC Tier {STAKE_TIER_REQUIRED} to enable staking.
            </p>
          )}
          {tierOk && stakableNum <= 0 && (
            <p className="text-xs text-navy-600">
              You have no {asset} available.{" "}
              <Link href="/account/deposit" className="underline">
                Deposit {asset}
              </Link>{" "}
              or{" "}
              <Link href="/account/trading/BTC-USDT" className="underline">
                buy on the spot market
              </Link>{" "}
              first.
            </p>
          )}
          {tierOk && amountValid && !amountAffordable && (
            <p className="text-xs text-red-700">
              Amount exceeds available balance ({formatAmount(stakable, asset)}{" "}
              {asset}).
            </p>
          )}
        </CardContent>
      </Card>
    </Container>
  );
}
