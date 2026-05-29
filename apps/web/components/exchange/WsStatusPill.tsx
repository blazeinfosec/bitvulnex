"use client";

import { cn } from "@/lib/utils";

export type WsStatus = "live" | "reconnecting" | "disconnected" | "connecting";

const LABEL: Record<WsStatus, string> = {
  live: "Live",
  reconnecting: "Reconnecting…",
  disconnected: "Disconnected",
  connecting: "Connecting…",
};

const DOT: Record<WsStatus, string> = {
  live: "bg-buy",
  reconnecting: "bg-warn",
  disconnected: "bg-sell",
  connecting: "bg-warn",
};

export interface WsStatusPillProps {
  status: WsStatus;
  className?: string;
}

/**
 * Small inline pill that surfaces the WebSocket connection state.
 * Used in the markets page header and on the trading view. The dot
 * pulses on `live` to make the "data is moving" promise visible even
 * when the ticker is briefly idle.
 */
export function WsStatusPill({ status, className }: WsStatusPillProps) {
  return (
    <div
      className={cn(
        "flex items-center gap-2 text-xs text-text-dim",
        className,
      )}
    >
      <span
        className={cn(
          "inline-block w-2 h-2 rounded-full",
          DOT[status],
          status === "live" ? "animate-pulse" : "",
        )}
        aria-hidden
      />
      <span aria-live="polite">{LABEL[status]}</span>
    </div>
  );
}
