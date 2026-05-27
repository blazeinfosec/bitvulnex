import { NextResponse } from "next/server";
import { buildOpenApiDocument, registerEndpoint } from "@/lib/openapi-registry";

// Importing route modules with side-effect-only registrations populates
// the registry on module load. Add new endpoint imports here as later
// phases ship new routes; intentionally-undocumented endpoints simply
// do not appear in this import list.
import "@/app/api/health/route";

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
