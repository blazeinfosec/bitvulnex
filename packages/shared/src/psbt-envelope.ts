// Lab caricature of BIP-174 PSBT. Real PSBTs are binary; the lab uses
// a text envelope so trainees can hand-craft them without pulling in a
// full PSBT codec. The shape is realistic enough for treasury flows
// (inputs, outputs, signature count, fee) — what we lose in fidelity
// we gain in approachability for CTF-style exercises.
//
// Envelope: optional preamble + "BVBE_PSBT_V1:" + JSON payload.
// Payload shape: { inputs, outputs, signatures, fee }.

export type PsbtInput = {
  txid: string;
  vout: number;
  amountSat: number;
  address: string;
};

export type PsbtOutput = {
  address: string;
  amountSat: number;
};

export type PsbtPayload = {
  inputs: PsbtInput[];
  outputs: PsbtOutput[];
  signatures: number;
  fee: number;
};

export const PSBT_MARKER = "BVBE_PSBT_V1:";

export function encodePsbt(payload: PsbtPayload): string {
  return PSBT_MARKER + JSON.stringify(payload);
}

/**
 * Parse a BVBE PSBT envelope. Skips any leading preamble and reads
 * the JSON payload that follows the first `BVBE_PSBT_V1:` marker.
 * If the input contains more markers (e.g. metadata segments
 * appended during a multi-step signing flow) the parser stops at
 * the next marker boundary.
 */
export function decodePsbt(envelope: string): PsbtPayload {
  const idx = envelope.indexOf(PSBT_MARKER);
  if (idx === -1) throw new Error("not a PSBT envelope");
  const body = envelope.slice(idx + PSBT_MARKER.length);
  const next = body.indexOf(PSBT_MARKER);
  const jsonText = next === -1 ? body : body.slice(0, next);
  return JSON.parse(jsonText.trim()) as PsbtPayload;
}

export function addSignature(envelope: string): string {
  const payload = decodePsbt(envelope);
  payload.signatures += 1;
  return encodePsbt(payload);
}
