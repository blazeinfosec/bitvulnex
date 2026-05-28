import { NextResponse, type NextRequest } from "next/server";
import { jwtVerify } from "jose";

const ADMIN_API_PREFIX = "/api/v2/admin";
const ACCOUNT_API_PREFIX = "/api/v2/me";

function secretBytes(): Uint8Array {
  const s = process.env.JWT_SECRET ?? "";
  return new TextEncoder().encode(s);
}

async function claimsFromHeader(
  header: string | null,
): Promise<{ sub: string; role: string } | null> {
  if (!header) return null;
  const m = header.match(/^Bearer\s+(.+)$/i);
  if (!m) return null;
  try {
    const { payload } = await jwtVerify(m[1] as string, secretBytes(), {
      issuer: "bvbe",
      audience: "bvbe-web",
      algorithms: ["HS256"],
    });
    return { sub: String(payload.sub), role: String(payload.role) };
  } catch {
    return null;
  }
}

export async function middleware(req: NextRequest) {
  // Internal Next.js subrequest hop — let it through so health
  // probes and on-demand revalidation don't have to mint a token.
  if (req.headers.get("x-middleware-subrequest")) {
    return NextResponse.next();
  }

  const path = req.nextUrl.pathname;

  if (path.startsWith(ADMIN_API_PREFIX)) {
    // Admin handlers consume x-bvbe-user-id / x-bvbe-role set here.
    // Strip any inbound copies first so the client can't spoof them
    // through the legitimate (non-bypassed) path.
    const headers = new Headers(req.headers);
    headers.delete("x-bvbe-user-id");
    headers.delete("x-bvbe-role");

    const claims = await claimsFromHeader(req.headers.get("authorization"));
    if (!claims) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    if (claims.role !== "admin" && claims.role !== "treasury") {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    headers.set("x-bvbe-user-id", claims.sub);
    headers.set("x-bvbe-role", claims.role);
    return NextResponse.next({ request: { headers } });
  }

  if (path.startsWith(ACCOUNT_API_PREFIX)) {
    // /api/v2/me/* handlers re-verify the bearer themselves via
    // userFromAuthorization(). The middleware only short-circuits
    // anonymous traffic so handlers can assume a verifiable token
    // when they run.
    const claims = await claimsFromHeader(req.headers.get("authorization"));
    if (!claims) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    return NextResponse.next();
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/api/v2/admin/:path*", "/api/v2/me/:path*"],
};
