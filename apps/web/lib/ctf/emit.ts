// Phase 11 slice 1 — Pattern A flag emission helper.
//
// When CTF mode is enabled, callers can attach a `_flag` field to a
// response payload by invoking maybeEmitFlag at the point in the
// handler where an exploit's server-side detection condition is true.
//
// The emitter does NO detection itself — that is the caller's
// responsibility. When CTF mode is off, the payload passes through
// untouched (byte-identical to today's behavior).
//
// SEE ALSO: docs/phases/phase-11/spec.md §"Pattern A — Inline emission"

import { flagFor, ctfModeEnabled } from "@/lib/ctf";

export function maybeEmitFlag<T extends object>(
  payload: T,
  vulnId: string,
): T & { _flag?: string } {
  if (!ctfModeEnabled()) return payload;
  return { ...payload, _flag: flagFor(vulnId) };
}
