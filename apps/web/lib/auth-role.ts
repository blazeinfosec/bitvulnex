// Role gate shared across the admin / treasury / compliance / support
// API surfaces. Admin is a superset of every other role — a senior
// admin should be able to step into any subrole without being granted
// each one individually.

import type { UserClaims } from "@bvbe/shared";

export class RoleError extends Error {
  readonly status = 403;
}

export type RequiredRole = "admin" | "treasury" | "compliance" | "support";

export function requireRole(claims: UserClaims, required: RequiredRole): void {
  const role = (claims as { role?: string }).role ?? "user";
  if (role === "admin") return;
  if (role !== required) {
    throw new RoleError(`role ${required} required`);
  }
}

export function requireAdmin(claims: UserClaims): void {
  requireRole(claims, "admin");
}
