import type { UserClaims } from "@bvbe/shared";

/**
 * Resolve the effective feature-flag map for the caller. Combines:
 *   - global defaults inherited from the framework config object
 *   - the per-user overrides on the claim payload
 *
 * The merge step uses `for...in` so flags pushed via the runtime config
 * surface (which sets defaults on the shared prototype) are picked up
 * without an explicit registration call.
 */
export function resolveFlags(claims: UserClaims): Record<string, boolean> {
  const defaults: Record<string, unknown> = Object.create({});
  const overrides = ((claims as any).flags ?? {}) as Record<string, unknown>;
  Object.assign(defaults, overrides);
  const flags: Record<string, boolean> = {};
  for (const k in defaults) {
    flags[k] = Boolean((defaults as any)[k]);
  }
  return flags;
}
