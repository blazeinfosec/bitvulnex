"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { SideToggle } from "../SideToggle";
import { BalancePill } from "../BalancePill";
import { Modal } from "../Modal";
import {
  PercentPills,
  ModalField,
  amountInputClass,
  InlineMessage,
  formatDecimal,
} from "../earn/modal-shared";
import { formatNumber } from "../NumberCell";
import { shouldConfirm } from "@/lib/trade/confirm";
import { baseDp, quoteDp } from "@/lib/trade/pair";
import { authedFetch } from "@/lib/token-storage";

export type OrderType = "limit" | "market" | "stop_limit" | "oco";

const TYPE_LABEL: Record<OrderType, string> = {
  limit: "Limit",
  market: "Market",
  stop_limit: "Stop-Limit",
  oco: "OCO",
};
const TYPES: OrderType[] = ["limit", "market", "stop_limit", "oco"];

export interface OrderFormProps {
  base: string;
  quote: string;
  pair: string;
  /** Most recent last-price; used as a hint for market totals. */
  lastPrice: number | null;
  /** Available base balance (for sell sizing) */
  baseAvailable: string;
  /** Available quote balance (for buy sizing) */
  quoteAvailable: string;
  /** Current user's KYC tier; null → not signed in. */
  kycTier: number | null;
  /** Used to convert non-stable quote notional to USD for the
   *  $1000 market-notional threshold (e.g. BTC/USDT last for ETH/BTC). */
  quoteToUsdRate: number | null;
  /** Called after a successful order submission. */
  onPlaced?: () => void;
  /** Setter exposed so the parent (page) can drive the price field
   *  when the user clicks an order-book row. */
  priceInput: string;
  onPriceInputChange: (v: string) => void;
  className?: string;
}

const TIER_REQUIRED_FOR_TRADE = 1;
const TIER_REQUIRED_FOR_ADVANCED = 2;

/**
 * The full trading order form. Spec mirrors Binance Spot:
 * - Buy/Sell tabs
 * - Limit / Market / Stop-Limit / OCO type tabs
 * - Price (disabled for market) / Amount / Total preview
 * - Stop trigger input for stop-limit
 * - Take-profit + stop-loss inputs for OCO
 * - 25/50/75/MAX percent pills sized off the relevant balance
 * - BalancePill showing the constraint
 * - Pre-trade confirmation modal for large-notional or risky orders
 * - Tier-gated submit: disabled with helpful copy if KYC < 1
 */
export function OrderForm({
  base,
  quote,
  pair,
  lastPrice,
  baseAvailable,
  quoteAvailable,
  kycTier,
  quoteToUsdRate,
  onPlaced,
  priceInput,
  onPriceInputChange,
  className,
}: OrderFormProps) {
  const pathname = usePathname();
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [type, setType] = useState<OrderType>("limit");
  const [amount, setAmount] = useState("");
  const [stopTrigger, setStopTrigger] = useState("");
  const [ocoStop, setOcoStop] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  // The "price" used for the form (Limit & Stop-Limit & OCO take-profit)
  const price = priceInput;

  // Available balance per side (buy debits quote; sell debits base)
  const availableStr = side === "buy" ? quoteAvailable : baseAvailable;
  const availableAsset = side === "buy" ? quote : base;
  const availableNum = Number(availableStr);

  const amountNum = Number(amount);
  const priceNum = Number(price);

  const total = useMemo(() => {
    if (type === "market") {
      if (!Number.isFinite(amountNum) || !lastPrice) return null;
      return amountNum * lastPrice;
    }
    if (!Number.isFinite(amountNum) || !Number.isFinite(priceNum)) return null;
    return amountNum * priceNum;
  }, [type, amountNum, priceNum, lastPrice]);

  const quoteIsUsdStable = quote === "USDT" || quote === "USDC";
  const triggers = useMemo(
    () =>
      shouldConfirm({
        type,
        side,
        amount: amountNum,
        price: type === "market" ? null : priceNum,
        lastPrice,
        available: availableNum,
        quoteIsUsdStable,
        quoteToUsdRate,
      }),
    [type, side, amountNum, priceNum, lastPrice, availableNum, quoteIsUsdStable, quoteToUsdRate],
  );

  // `kycTier === null` means anonymous — show a sign-in CTA rather
  // than tier-gate copy. An authed user always has a numeric tier.
  const isAnonymous = kycTier === null || kycTier === undefined;
  const tierOkBasic = !isAnonymous && (kycTier ?? -1) >= TIER_REQUIRED_FOR_TRADE;
  const tierOkAdvanced =
    type === "stop_limit" || type === "oco"
      ? !isAnonymous && (kycTier ?? -1) >= TIER_REQUIRED_FOR_ADVANCED
      : true;

  const amountValid = amount !== "" && Number.isFinite(amountNum) && amountNum > 0;
  const priceValid =
    type === "market" ||
    (price !== "" && Number.isFinite(priceNum) && priceNum > 0);
  const stopValid =
    (type === "stop_limit" || type === "oco")
      ? stopTrigger !== "" && Number(stopTrigger) > 0
      : true;
  const ocoValid =
    type === "oco" ? ocoStop !== "" && Number(ocoStop) > 0 : true;

  const canSubmit =
    !busy &&
    amountValid &&
    priceValid &&
    stopValid &&
    ocoValid &&
    tierOkBasic &&
    tierOkAdvanced;

  // Percent pills compute against the *amount* the user can place.
  // Buy: max base = quoteAvailable / price; Sell: max base = baseAvailable.
  const pickPctAvailable = useMemo(() => {
    if (side === "sell") return baseAvailable;
    const refPrice = type === "market" ? lastPrice ?? 0 : priceNum;
    if (!refPrice || refPrice <= 0) return "0";
    const max = availableNum / refPrice;
    return Number.isFinite(max) && max > 0 ? max.toString() : "0";
  }, [side, type, priceNum, lastPrice, availableNum, baseAvailable]);

  function reset() {
    setAmount("");
    setStopTrigger("");
    setOcoStop("");
    setError(null);
  }

  async function actuallySubmit() {
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const body: Record<string, unknown> = { pair, side, type, amount };
      if (type === "limit") body.price = price;
      if (type === "stop_limit") {
        body.price = price;
        body.stopTrigger = stopTrigger;
      }
      if (type === "oco") {
        body.price = price; // limit (take-profit) leg
        body.stopTrigger = ocoStop;
      }
      const res = await authedFetch("/api/v2/me/orders", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        setSuccess(`Order placed (${TYPE_LABEL[type]} ${side})`);
        reset();
        onPlaced?.();
      } else {
        const b = (await res.json().catch(() => ({}))) as {
          error?: { message?: string };
        };
        setError(b.error?.message ?? `Place failed (${res.status})`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error");
    } finally {
      setBusy(false);
      setConfirmOpen(false);
    }
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    if (triggers.length > 0) {
      setConfirmOpen(true);
    } else {
      void actuallySubmit();
    }
  }

  // When type changes, clear stale fields
  useEffect(() => {
    setError(null);
  }, [type, side]);

  const sideColorClass =
    side === "buy"
      ? "bg-buy text-bg hover:bg-buy/90"
      : "bg-sell text-bg hover:bg-sell/90";

  const submitLabel = busy
    ? "Placing…"
    : isAnonymous
      ? "Sign in to trade"
      : !tierOkBasic
        ? "KYC Tier 1 required"
        : !tierOkAdvanced
          ? `KYC Tier ${TIER_REQUIRED_FOR_ADVANCED} required`
          : `${side === "buy" ? "Buy" : "Sell"} ${base}`;

  return (
    <div
      className={cn(
        "flex flex-col gap-3 border border-border rounded-lg bg-bg-elevated p-4",
        className,
      )}
    >
      <SideToggle value={side} onChange={setSide} />

      <div role="tablist" aria-label="Order type" className="flex gap-1">
        {TYPES.map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={type === t}
            onClick={() => setType(t)}
            className={cn(
              "flex-1 text-xs h-8 rounded-md border border-border transition-colors",
              type === t
                ? "bg-bg-hover text-text"
                : "text-text-dim hover:text-text hover:bg-bg-hover",
            )}
          >
            {TYPE_LABEL[t]}
          </button>
        ))}
      </div>

      <form className="space-y-3" onSubmit={onSubmit}>
        {/* Price input — disabled for market orders */}
        <ModalField label={`Price (${quote})`}>
          <input
            className={amountInputClass}
            placeholder={type === "market" ? "Market" : "0.00"}
            inputMode="decimal"
            disabled={type === "market" || busy}
            value={type === "market" ? "" : price}
            onChange={(e) => onPriceInputChange(e.target.value)}
          />
        </ModalField>

        {/* Stop trigger for stop-limit; renamed to take-profit/stop-loss pair for OCO */}
        {type === "stop_limit" && (
          <ModalField label={`Stop trigger (${quote})`}>
            <input
              className={amountInputClass}
              placeholder="0.00"
              inputMode="decimal"
              disabled={busy}
              value={stopTrigger}
              onChange={(e) => setStopTrigger(e.target.value)}
            />
          </ModalField>
        )}

        {type === "oco" && (
          <ModalField label={`Stop trigger / Stop-loss (${quote})`}>
            <input
              className={amountInputClass}
              placeholder="0.00"
              inputMode="decimal"
              disabled={busy}
              value={ocoStop}
              onChange={(e) => setOcoStop(e.target.value)}
            />
            <p className="text-2xs text-text-mute">
              Limit price above acts as take-profit. Stop above triggers the
              stop-loss leg. The two legs cancel each other on fill.
            </p>
          </ModalField>
        )}

        <ModalField
          label={`Amount (${base})`}
          hint={
            <BalancePill
              value={availableStr}
              asset={availableAsset}
              dp={
                availableAsset === quote
                  ? quoteDp(quote)
                  : baseDp(base)
              }
            />
          }
        >
          <input
            className={amountInputClass}
            placeholder="0.00"
            inputMode="decimal"
            disabled={busy}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
          <PercentPills
            available={pickPctAvailable}
            onPick={setAmount}
            disabled={busy}
          />
        </ModalField>

        <div className="flex items-center justify-between text-xs text-text-dim">
          <span>Total ({quote})</span>
          <span className="font-mono tabular-nums text-text">
            {total !== null ? formatNumber(total, quoteDp(quote)) : "—"}
          </span>
        </div>

        {isAnonymous ? (
          <div
            role="status"
            className="rounded-md border border-border bg-bg p-3 text-xs text-text-dim"
          >
            <p className="mb-2">
              You're browsing as a guest. Sign in or create an account to
              place orders on this pair.
            </p>
            <div className="flex gap-2">
              <a
                href={`/login?next=${encodeURIComponent(pathname ?? "/")}`}
                className="inline-flex items-center justify-center h-8 px-3 text-xs font-medium rounded-md bg-accent text-accent-fg hover:bg-accent-hover transition-colors no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                Sign in
              </a>
              <a
                href="/signup"
                className="inline-flex items-center justify-center h-8 px-3 text-xs font-medium rounded-md border border-border text-text hover:bg-bg-hover transition-colors no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                Create account
              </a>
            </div>
          </div>
        ) : null}
        {!isAnonymous && !tierOkBasic && (
          <InlineMessage
            kind="err"
            text="KYC Tier 1 required to trade. Complete identity verification to enable orders."
          />
        )}
        {!isAnonymous && tierOkBasic && !tierOkAdvanced && (
          <InlineMessage
            kind="err"
            text={`KYC Tier ${TIER_REQUIRED_FOR_ADVANCED} required for ${TYPE_LABEL[type]} orders.`}
          />
        )}
        {error && <InlineMessage kind="err" text={error} />}
        {success && <InlineMessage kind="ok" text={success} />}

        <button
          type="submit"
          disabled={!canSubmit}
          className={cn(
            "w-full h-11 rounded-md text-sm font-semibold transition-colors",
            "disabled:opacity-40 disabled:cursor-not-allowed",
            canSubmit ? sideColorClass : "bg-bg-hover text-text-dim",
          )}
        >
          {submitLabel}
        </button>
      </form>

      <ConfirmModal
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={actuallySubmit}
        busy={busy}
        side={side}
        type={type}
        pair={pair}
        amount={amount}
        price={
          type === "market"
            ? lastPrice
              ? formatDecimal(lastPrice, quoteDp(quote))
              : "—"
            : price
        }
        total={total !== null ? formatNumber(total, quoteDp(quote)) : "—"}
        base={base}
        quote={quote}
        triggers={triggers}
      />
    </div>
  );
}

interface ConfirmModalProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  busy: boolean;
  side: "buy" | "sell";
  type: OrderType;
  pair: string;
  amount: string;
  price: string;
  total: string;
  base: string;
  quote: string;
  triggers: ReturnType<typeof shouldConfirm>;
}

function ConfirmModal(p: ConfirmModalProps) {
  return (
    <Modal
      open={p.open}
      onClose={p.busy ? () => {} : p.onClose}
      disableBackdropClose={p.busy}
      title="Confirm order"
      description="This order tripped one of our pre-trade risk checks. Review the details before submitting."
      footer={
        <>
          <button
            type="button"
            onClick={p.onClose}
            disabled={p.busy}
            className="h-9 px-4 text-sm font-medium rounded-md border border-border text-text hover:bg-bg-hover disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={p.onConfirm}
            disabled={p.busy}
            className={cn(
              "h-9 px-4 text-sm font-semibold rounded-md text-bg disabled:opacity-50",
              p.side === "buy" ? "bg-buy" : "bg-sell",
            )}
          >
            {p.busy
              ? "Placing…"
              : p.side === "buy"
                ? `Confirm Buy ${p.base}`
                : `Confirm Sell ${p.base}`}
          </button>
        </>
      }
    >
      <dl className="space-y-2 text-sm">
        <Row label="Pair" value={p.pair} />
        <Row
          label="Side"
          value={
            <span
              className={cn(
                "uppercase font-semibold",
                p.side === "buy" ? "text-buy" : "text-sell",
              )}
            >
              {p.side}
            </span>
          }
        />
        <Row label="Type" value={TYPE_LABEL[p.type]} />
        <Row label="Amount" value={`${p.amount} ${p.base}`} />
        <Row label="Price" value={p.type === "market" ? `~${p.price} (market)` : `${p.price} ${p.quote}`} />
        <Row label="Total" value={`${p.total} ${p.quote}`} />
      </dl>
      <ul className="mt-4 space-y-1 text-xs">
        {p.triggers.includes("large-fraction-of-balance") && (
          <li className="text-warn">
            ⚠ This order uses more than 10% of your available balance.
          </li>
        )}
        {p.triggers.includes("large-market-notional") && (
          <li className="text-warn">
            ⚠ Market order notional exceeds $1,000.
          </li>
        )}
      </ul>
    </Modal>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-1.5 border-b border-border-subtle last:border-0">
      <dt className="text-text-mute uppercase tracking-wider text-xs">
        {label}
      </dt>
      <dd className="font-mono tabular-nums text-text text-sm">{value}</dd>
    </div>
  );
}
