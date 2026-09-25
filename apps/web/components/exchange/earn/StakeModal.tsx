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
  failureMessage,
  normalizeAmount,
} from "./modal-shared";

export interface StakeModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
  asset: string;
  rewardAsset: string;
  available: string;
  apyBps: number;
  windowSeconds: number;
}

export function StakeModal({
  open,
  onClose,
  onSuccess,
  asset,
  rewardAsset,
  available,
  apyBps,
  windowSeconds,
}: StakeModalProps) {
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

  const apy = apyBps / 100;
  const amountNum = Number(amount);
  const availNum = Number(available);
  const amountValid =
    amount !== "" && Number.isFinite(amountNum) && amountNum > 0;
  const amountAffordable = amountValid && amountNum <= availNum;
  const yearlyYield = amountValid ? (amountNum * apy) / 100 : 0;
  const canSubmit = amountAffordable && !busy;

  async function submit() {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      const res = await authedFetch("/api/v2/me/staking/stake", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ asset, amount: normalizeAmount(amount) }),
      });
      if (res.ok) {
        onSuccess();
        onClose();
      } else {
        setError(await failureMessage(res, "Stake"));
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
      title={`Stake ${asset}`}
      description={`Lock ${asset} to earn ${apy.toFixed(2)}% APY in ${rewardAsset}. Rewards materialize every ${windowSeconds}s.`}
      disableBackdropClose={busy}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!canSubmit}>
            {busy ? "Staking…" : `Stake ${amount || "0"} ${asset}`}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <ModalField
          label="Amount"
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
          <PercentPills available={available} onPick={setAmount} disabled={busy} />
        </ModalField>

        <div className="rounded-md bg-bg border border-border-subtle px-3 py-2 text-xs text-text-dim space-y-1">
          <div className="flex justify-between">
            <span>APY</span>
            <span className="text-text font-mono tabular-nums">
              {apy.toFixed(2)}%
            </span>
          </div>
          <div className="flex justify-between">
            <span>Reward window</span>
            <span className="text-text font-mono tabular-nums">
              {windowSeconds}s
            </span>
          </div>
          {amountValid && (
            <div className="flex justify-between">
              <span>Estimated yearly yield</span>
              <span className="text-text font-mono tabular-nums">
                +{formatDecimal(yearlyYield, 8)} {rewardAsset}
              </span>
            </div>
          )}
        </div>

        {amountValid && !amountAffordable && (
          <p className="text-xs text-sell">
            Insufficient {asset}. Available: {formatDecimal(available)} {asset}.
          </p>
        )}

        {error && <InlineMessage kind="err" text={error} />}
      </div>
    </Modal>
  );
}
