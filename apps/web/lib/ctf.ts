import { createHash } from "node:crypto";
import { env } from "./env.js";

export function flagFor(vulnId: string): string {
  const salt = env().CTF_SALT;
  const digest = createHash("sha256")
    .update(`${vulnId}:${salt}`)
    .digest("hex")
    .slice(0, 32);
  return `BVBE{${digest}}`;
}

export function ctfModeEnabled(): boolean {
  return env().CTF_MODE;
}
