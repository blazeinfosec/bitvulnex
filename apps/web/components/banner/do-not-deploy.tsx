import { AlertTriangle } from "lucide-react";

export function DoNotDeployBanner({
  variant = "top",
}: {
  variant?: "top" | "footer";
}) {
  return (
    <div
      role="alert"
      className={
        variant === "top"
          ? "w-full bg-bg-elevated text-warn text-sm border-b border-warn/40"
          : "w-full bg-bg-elevated text-warn text-sm border-t border-warn/40"
      }
    >
      <div className="mx-auto max-w-7xl px-4 py-2 flex items-center gap-2 justify-center text-center font-medium">
        <AlertTriangle className="h-4 w-4 flex-shrink-0" aria-hidden />
        <span>
          DO NOT DEPLOY — Blaze Vulnerable Bitcoin Exchange is an
          intentionally vulnerable lab.{" "}
          {variant === "top" ? (
            <>See the LICENSE for terms of use.</>
          ) : (
            <>Authorized security training only. No real funds. No public networks.</>
          )}
        </span>
      </div>
    </div>
  );
}
