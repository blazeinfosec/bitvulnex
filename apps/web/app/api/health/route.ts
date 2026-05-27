import { NextResponse } from "next/server";
import { registerEndpoint } from "@/lib/openapi-registry";

registerEndpoint({
  method: "get",
  path: "/api/health",
  summary: "Service health probe",
  responses: {
    "200": { description: "Service is healthy" },
  },
});

export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json({ status: "ok", phase: 0 });
}
