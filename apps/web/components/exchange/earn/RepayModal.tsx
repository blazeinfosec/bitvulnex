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

export interface RepayModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
  positionId: string;
  asset: string;
  principal: string;
  accrued: string;
  /** Wallet balance of the asset, used to populate percent pills + MAX. */
  available: string;
}

export function RepayModal({
  open,
  onClose,
  onSuccess,
  positionId,
  asset,
  principal,
  accrued,
  available,
}: RepayModalProps) {
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setAmount("");
      setError(null);
      setBusy(false);
    }
  }, [open]);

  const totalOwed = Number(principal) + Number(accrued);
  const availNum = Number(available);
  const maxRepay = Math.min(totalOwed, availNum);
  const amountNum = Number(amount);
  const amountValid =
    amount !== "" && Number.isFinite(amountNum) && amountNum > 0;
  const amountAffordable = amountValid && amountNum <= availNum;
  const willClose = amountValid && amountNum >= totalOwed - 1e-12;
  const canSubmit = amountAffordable && !busy;

  return (
    <Modal
      open={open}
      onClose={busy ? () => {} : onClose}
      title={`Repay ${asset}`}
      description="Pay down debt on this borrow position. Partial repayments allowed."
      disableBackdropClose={busy}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!canSubmit}>
            {busy ? "Repaying…" : `Repay ${amount || "0"} ${asset}`}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="rounded-md bg-bg border border-border-subtle px-3 py-2 text-xs text-text-dim space-y-1">
          <div className="flex justify-between">
            <span>Principal</span>
            <span className="text-text font-mono tabular-nums">
              {formatDecimal(principal)} {asset}
            </span>
          </div>
          <div className="flex justify-between">
            <span>Accrued interest</span>
            <span className="text-text font-mono tabular-nums">
              {formatDecimal(accrued)} {asset}
            </span>
          </div>
          <div className="flex justify-between border-t border-border-subtle pt-1">
            <span className="text-text">Total owed</span>
            <span className="text-text font-mono tabular-nums font-semibold">
              {formatDecimal(totalOwed)} {asset}
            </span>
          </div>
        </div>

        <ModalField
          label="Repay amount"
          hint={<BalancePill value={available} asset={asset} />}
        >
          <input
            className={amountInputClass}
            placeholder="0.00"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            disabled={busy}
          />
          <PercentPills
            available={maxRepay.toString()}
            onPick={setAmount}
            disabled={busy}
          />
        </ModalField>

        {willClose && (
          <div className="rounded-md border border-buy/30 bg-buy/10 px-3 py-2 text-xs text-buy">
            This repayment will close the position.
          </div>
        )}

        {amountValid && !amountAffordable && (
          <p className="text-xs text-sell">
            Insufficient {asset}. Available: {formatDecimal(available)} {asset}.
          </p>
        )}

        {error && <InlineMessage kind="err" text={error} />}
      </div>
    </Modal>
  );

  async function submit() {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      const res = await authedFetch("/api/v2/me/lending/repay", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ positionId, amount }),
      });
      if (res.ok) {
        onSuccess();
        onClose();
      } else {
        const body = await res.text();
        setError(`Repay failed (${res.status}): ${body || "unknown error"}`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error");
    } finally {
      setBusy(false);
    }
  }
}
