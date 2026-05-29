"use client";

import { useEffect, useState } from "react";
import { Modal } from "../Modal";
import { BalancePill } from "../BalancePill";
import { Button } from "@/components/ui/button";
import { authedFetch } from "@/lib/token-storage";
import {
  PercentPills,
  ModalField,
  amountInputClass,
  InlineMessage,
  formatDecimal,
} from "./modal-shared";

export interface BorrowAvailableAsset {
  asset: string;
  available: string;
}

export interface BorrowModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
  asset: string;
  apyBps: number;
  /** All non-zero spot balances the user could pledge as collateral. */
  collateralOptions: BorrowAvailableAsset[];
}

// 150% LTV: collateralAmount must equal 1.5x notional. Borrow lib expects
// collateral in the same units as the asset, computed off-line by client.
const LTV_RATIO = 1.5;

export function BorrowModal({
  open,
  onClose,
  onSuccess,
  asset,
  apyBps,
  collateralOptions,
}: BorrowModalProps) {
  const [amount, setAmount] = useState("");
  const [collateralAsset, setCollateralAsset] = useState<string>(
    collateralOptions[0]?.asset ?? "",
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setAmount("");
      setError(null);
      setBusy(false);
      setCollateralAsset(collateralOptions[0]?.asset ?? "");
    }
  }, [open, collateralOptions]);

  const apy = apyBps / 100;
  const amountNum = Number(amount);
  const amountValid =
    amount !== "" && Number.isFinite(amountNum) && amountNum > 0;
  const collateralNeeded = amountValid ? amountNum * LTV_RATIO : 0;
  const collateralAvail = Number(
    collateralOptions.find((c) => c.asset === collateralAsset)?.available ?? "0",
  );
  const collateralOk = amountValid && collateralNeeded <= collateralAvail;
  const canSubmit = amountValid && collateralOk && collateralAsset && !busy;

  async function submit() {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      const res = await authedFetch("/api/v2/me/lending/borrow", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          asset,
          amount,
          collateralAsset,
          collateralAmount: collateralNeeded.toFixed(8),
        }),
      });
      if (res.ok) {
        onSuccess();
        onClose();
      } else {
        const body = await res.text();
        setError(`Borrow failed (${res.status}): ${body || "unknown error"}`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={busy ? () => {} : onClose}
      title={`Borrow ${asset}`}
      description={`Borrow against collateral at ${apy.toFixed(2)}% APY. Requires 150% over-collateralization.`}
      disableBackdropClose={busy}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!canSubmit}>
            {busy ? "Borrowing…" : `Borrow ${amount || "0"} ${asset}`}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <ModalField label={`Amount to borrow (${asset})`}>
          <input
            className={amountInputClass}
            placeholder="0.00"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            disabled={busy}
          />
        </ModalField>

        <ModalField
          label="Collateral asset"
          hint={
            collateralAsset ? (
              <BalancePill
                value={
                  collateralOptions.find((c) => c.asset === collateralAsset)
                    ?.available ?? "0"
                }
                asset={collateralAsset}
              />
            ) : null
          }
        >
          {collateralOptions.length === 0 ? (
            <div className="text-sm text-text-dim">
              No spendable balance available to pledge as collateral.
            </div>
          ) : (
            <select
              className={amountInputClass}
              value={collateralAsset}
              onChange={(e) => setCollateralAsset(e.target.value)}
              disabled={busy}
            >
              {collateralOptions.map((c) => (
                <option key={c.asset} value={c.asset}>
                  {c.asset} — {formatDecimal(c.available)} available
                </option>
              ))}
            </select>
          )}
          <PercentPills
            available={(collateralAvail / LTV_RATIO).toString()}
            onPick={setAmount}
            disabled={busy}
          />
        </ModalField>

        <div className="rounded-md bg-bg border border-border-subtle px-3 py-2 text-xs text-text-dim space-y-1">
          <div className="flex justify-between">
            <span>LTV ratio</span>
            <span className="text-text font-mono tabular-nums">150%</span>
          </div>
          <div className="flex justify-between">
            <span>Collateral required</span>
            <span className="text-text font-mono tabular-nums">
              {formatDecimal(collateralNeeded, 8)} {collateralAsset || "—"}
            </span>
          </div>
          <div className="flex justify-between">
            <span>Borrow APY</span>
            <span className="text-text font-mono tabular-nums">
              {apy.toFixed(2)}%
            </span>
          </div>
        </div>

        {amountValid && !collateralOk && (
          <p className="text-xs text-sell">
            Insufficient {collateralAsset}. Need {formatDecimal(collateralNeeded)},
            available {formatDecimal(collateralAvail.toString())}.
          </p>
        )}

        {error && <InlineMessage kind="err" text={error} />}
      </div>
    </Modal>
  );
}
