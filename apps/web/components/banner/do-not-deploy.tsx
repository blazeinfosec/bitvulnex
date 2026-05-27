import { AlertTriangle } from "lucide-react";

export function DoNotDeployBanner({
  variant = "top",
}: {
  variant?: "top" | "footer";
}) {
  return (
    <div
      role="alert"
      className="w-full bg-danger text-danger-fg font-medium text-sm"
    >
      <div className="mx-auto max-w-7xl px-4 py-2 flex items-center gap-2 justify-center text-center">
        <AlertTriangle className="h-4 w-4 flex-shrink-0" aria-hidden />
        <span>
          DO NOT DEPLOY — Blaze Vulnerable Bitcoin Exchange is an
          intentionally vulnerable lab.{" "}
          {variant === "top" ? (
            <>
              See{" "}
              <a href="/about/changelog" className="underline">
                /about/changelog
              </a>{" "}
              and the LICENSE for terms of use.
            </>
          ) : (
            <>Authorized security training only. No real funds. No public networks.</>
          )}
        </span>
      </div>
    </div>
  );
}
