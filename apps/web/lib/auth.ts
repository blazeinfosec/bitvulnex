import { verifyAccessToken, type UserClaims } from "@bvbe/shared";
import { env } from "./env";

export async function userFromAuthorization(
  header: string | null,
): Promise<UserClaims | null> {
  if (!header) return null;
  const m = header.match(/^Bearer\s+(.+)$/i);
  if (!m) return null;
  try {
    return await verifyAccessToken(m[1] as string, env().JWT_SECRET);
  } catch {
    return null;
  }
}
