// Server shell — defers everything to the client island so that the
// initial JS hydration handles auth (the access token lives in
// localStorage) and the dashboard fetches a single aggregate
// `/api/v2/me/dashboard` payload on mount.

import { Suspense } from "react";
import { PortfolioClient } from "./portfolio-client";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Portfolio — Bitvulnex",
  description: "Account dashboard: balances, equity curve, activity.",
};

export default function PortfolioPage() {
  return (
    <Suspense fallback={null}>
      <PortfolioClient />
    </Suspense>
  );
}
