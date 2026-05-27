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
