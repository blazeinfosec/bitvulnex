"use client";

import { useEffect, useState } from "react";
import { Modal } from "../Modal";
import { Button } from "@/components/ui/button";
import { authedFetch } from "@/lib/token-storage";
import {
  InlineMessage,
  formatDecimal,
  failureMessage,
} from "./modal-shared";

export interface WithdrawModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
  positionId: string;
  asset: string;
  principal: string;
  accrued: string;
}

export function WithdrawModal({
  open,
  onClose,
  onSuccess,
  positionId,
  asset,
  principal,
  accrued,
}: WithdrawModalProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setError(null);
      setBusy(false);
    }
  }, [open]);

  const total = Number(principal) + Number(accrued);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const res = await authedFetch("/api/v2/me/lending/withdraw", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ positionId }),
      });
      if (res.ok) {
        onSuccess();
        onClose();
      } else {
        setError(await failureMessage(res, "Withdraw"));
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
      title={`Withdraw ${asset}`}
      description="Close this supply position and credit principal + accrued back to your spot balance."
      disableBackdropClose={busy}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={busy}>
            {busy ? "Withdrawing…" : `Withdraw ${formatDecimal(total)} ${asset}`}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="rounded-md bg-bg border border-border-subtle px-3 py-3 text-sm space-y-2">
          <div className="flex justify-between">
            <span className="text-text-dim">Principal</span>
            <span className="text-text font-mono tabular-nums">
              {formatDecimal(principal)} {asset}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-text-dim">Accrued interest</span>
            <span className="text-buy font-mono tabular-nums">
              +{formatDecimal(accrued)} {asset}
            </span>
          </div>
          <div className="flex justify-between border-t border-border-subtle pt-2">
            <span className="text-text font-medium">Total credit</span>
            <span className="text-text font-mono tabular-nums font-semibold">
              {formatDecimal(total)} {asset}
            </span>
          </div>
        </div>
        {error && <InlineMessage kind="err" text={error} />}
      </div>
    </Modal>
  );
}
