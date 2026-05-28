import { NextResponse } from "next/server";
import { buildOpenApiDocument, registerEndpoint } from "@/lib/openapi-registry";

// Importing route modules with side-effect-only registrations populates
// the registry on module load. Add new endpoint imports here as later
// phases ship new routes; intentionally-undocumented endpoints simply
// do not appear in this import list.
import "@/app/api/health/route";
import "@/app/api/v2/auth/signup/route";
import "@/app/api/v2/auth/login/route";
import "@/app/api/v2/auth/login/totp/route";
import "@/app/api/v2/auth/refresh/route";
import "@/app/api/v2/auth/logout/route";
import "@/app/api/v2/auth/password-reset/request/route";
import "@/app/api/v2/auth/password-reset/confirm/route";
import "@/app/api/v2/auth/2fa/enable/route";
import "@/app/api/v2/auth/2fa/verify/route";
import "@/app/api/v2/auth/2fa/disable/route";
import "@/app/api/v2/me/route";
import "@/app/api/v2/me/api-keys/route";
import "@/app/api/v2/me/api-keys/[id]/route";
import "@/app/api/v2/me/kyc/route";
import "@/app/api/v2/me/kyc/profile/route";
import "@/app/api/v2/me/kyc/documents/route";
import "@/app/api/v2/me/kyc/import-url/route";
import "@/app/api/v2/me/kyc/doc/route";
import "@/app/api/v2/me/kyc/submit/route";
import "@/app/api/v2/me/deposit/address/route";
import "@/app/api/v2/me/deposits/route";
import "@/app/api/v2/me/balance/route";
import "@/app/api/v2/me/orders/route";
import "@/app/api/v2/public/price/[pair]/route";
import "@/app/api/v2/public/book/[pair]/route";
import "@/app/api/v2/me/margin/positions/route";
import "@/app/api/v2/me/margin/transfer/route";
import "@/app/api/v2/me/keeper/register/route";
import "@/app/api/v2/keeper/liquidations/route";
import "@/app/api/v2/keeper/liquidations/[id]/claim/route";
import "@/app/api/v2/public/lending/pools/route";
import "@/app/api/v2/public/staking/programs/route";
import "@/app/api/v2/public/p2p/offers/route";
import "@/app/api/v2/me/lending/supply/route";
import "@/app/api/v2/me/lending/withdraw/route";
import "@/app/api/v2/me/lending/borrow/route";
import "@/app/api/v2/me/lending/repay/route";
import "@/app/api/v2/me/lending/positions/route";
import "@/app/api/v2/me/staking/stake/route";
import "@/app/api/v2/me/staking/unstake/route";
import "@/app/api/v2/me/staking/claim/route";
import "@/app/api/v2/me/otc/quote/route";
import "@/app/api/v2/me/otc/accept/route";
import "@/app/api/v2/me/p2p/offers/route";
import "@/app/api/v2/me/p2p/offers/[id]/route";
import "@/app/api/v2/me/p2p/trades/route";
import "@/app/api/v2/me/p2p/trades/[id]/mark-paid/route";
import "@/app/api/v2/me/p2p/trades/[id]/release/route";
import "@/app/api/v2/me/withdrawals/route";
import "@/app/api/v2/me/withdrawals/[id]/route";
import "@/app/api/v2/me/withdrawals/[id]/cancel/route";
import "@/app/api/v2/me/internal-transfer/route";
import "@/app/api/v2/admin/treasury/drafts/route";
import "@/app/api/v2/admin/treasury/drafts/[id]/sign/route";
import "@/app/api/v2/admin/treasury/drafts/[id]/broadcast/route";
import "@/app/api/v2/admin/withdrawals/[id]/bump/route";
import "@/app/api/v2/public/treasury/hot-wallet/route";
import "@/app/api/v2/me/flags/route";
import "@/app/api/v2/me/tickets/route";
import "@/app/api/v2/admin/users/search/route";

registerEndpoint({
  method: "get",
  path: "/api/openapi.json",
  summary: "OpenAPI 3.1 document for the public API",
  responses: {
    "200": { description: "OpenAPI JSON document" },
  },
});

export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json(buildOpenApiDocument());
}
