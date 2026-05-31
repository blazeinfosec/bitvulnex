import { env } from "./env";
import { deriveDigest, formatFlag } from "./ctf/derive";

export function flagFor(vulnId: string): string {
  // Salt-derived (Pattern A / B / chain) flags rotate per cohort via
  // CTF_SALT. Format is the canonical {BLAZE_BITVULNEX_...} envelope.
  return formatFlag(deriveDigest(`${vulnId}:${env().CTF_SALT}`));
}

export function ctfModeEnabled(): boolean {
  return env().CTF_MODE;
}
