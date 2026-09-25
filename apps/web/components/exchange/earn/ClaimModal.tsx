"use client";

import { useEffect, useState } from "react";
import { Modal } from "../Modal";
import { Button } from "@/components/ui/button";
import { authedFetch } from "@/lib/token-storage";
import { InlineMessage, formatDecimal } from "./modal-shared";

export interface ClaimModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
  positionId: string;
  asset: string;
  accrued: string;
  windows: number;
}

export function ClaimModal({
  open,
  onClose,
  onSuccess,
  positionId,
  asset,
  accrued,
  windows,
}: ClaimModalProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setError(null);
      setBusy(false);
    }
  }, [open]);

  const noRewards = !(Number(accrued) > 0);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const res = await authedFetch("/api/v2/me/staking/claim", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ positionId }),
      });
      // The claim handler returns 200 even when there were no
      // materialized rewards yet — it just credits 0. We treat that
      // case explicitly so the user gets useful feedback instead of a
      // silent close. Real errors (400/401/5xx) fall through.
      if (res.ok) {
        const body = (await res
          .json()
          .catch(() => null)) as { rows?: number; credited?: string } | null;
        if (body && (body.rows === 0 || Number(body.credited ?? 0) === 0)) {
          setError(
            "No unclaimed rewards yet. Rewards materialize on a fixed window — check back shortly.",
          );
          return;
        }
        onSuccess();
        onClose();
      } else {
        const errText = await res
          .json()
          .then((j: { error?: { message?: string } | string } | null) => {
            if (!j) return null;
            const msg =
              typeof j.error === "string"
                ? j.error
                : j.error?.message ?? null;
            return msg;
          })
          .catch(() => null);
        setError(
          errText
            ? `Claim failed: ${errText}`
            : `Claim failed (${res.status}).`,
        );
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
      title={`Claim ${asset} rewards`}
      description="Move materialized staking rewards into your spot balance."
      disableBackdropClose={busy}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={busy || noRewards}>
            {busy
              ? "Claiming…"
              : `Claim ${formatDecimal(accrued)} ${asset}`}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="rounded-md bg-bg border border-border-subtle px-3 py-3 text-sm space-y-2">
          <div className="flex justify-between">
            <span className="text-text-dim">Unclaimed rewards</span>
            <span className="text-buy font-mono tabular-nums font-semibold">
              +{formatDecimal(accrued)} {asset}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-text-dim">Reward windows</span>
            <span className="text-text font-mono tabular-nums">{windows}</span>
          </div>
        </div>
        {noRewards && (
          <p className="text-xs text-text-dim">
            No rewards materialized yet. Each reward window pays out a small
            fraction of accrued APY; rewards become claimable once a window
            ticks.
          </p>
        )}
        {error && <InlineMessage kind="err" text={error} />}
      </div>
    </Modal>
  );
}
