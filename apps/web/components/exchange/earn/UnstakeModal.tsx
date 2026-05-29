"use client";

import { useEffect, useState } from "react";
import { Modal } from "../Modal";
import { Button } from "@/components/ui/button";
import { authedFetch } from "@/lib/token-storage";
import { InlineMessage, formatDecimal } from "./modal-shared";

export interface UnstakeModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
  positionId: string;
  asset: string;
  principal: string;
  accrued: string;
}

export function UnstakeModal({
  open,
  onClose,
  onSuccess,
  positionId,
  asset,
  principal,
  accrued,
}: UnstakeModalProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setError(null);
      setBusy(false);
    }
  }, [open]);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const res = await authedFetch("/api/v2/me/staking/unstake", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ positionId }),
      });
      if (res.ok) {
        onSuccess();
        onClose();
      } else {
        const body = await res.text();
        setError(`Unstake failed (${res.status}): ${body || "unknown error"}`);
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
      title={`Unstake ${asset}`}
      description="Stop earning rewards and credit principal back to your spot balance. Any unclaimed rewards remain available to claim separately."
      disableBackdropClose={busy}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={busy}>
            {busy ? "Unstaking…" : `Unstake ${formatDecimal(principal)} ${asset}`}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="rounded-md bg-bg border border-border-subtle px-3 py-3 text-sm space-y-2">
          <div className="flex justify-between">
            <span className="text-text-dim">Principal returning</span>
            <span className="text-text font-mono tabular-nums font-semibold">
              {formatDecimal(principal)} {asset}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-text-dim">Unclaimed rewards</span>
            <span className="text-text-dim font-mono tabular-nums">
              {formatDecimal(accrued)} {asset}{" "}
              <span className="text-text-mute text-xs">(claim separately)</span>
            </span>
          </div>
        </div>
        {error && <InlineMessage kind="err" text={error} />}
      </div>
    </Modal>
  );
}
