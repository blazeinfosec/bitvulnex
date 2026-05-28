import { describe, it, expect } from "vitest";
import {
  encodePsbt,
  decodePsbt,
  addSignature,
  type PsbtPayload,
} from "./psbt-envelope";

const samplePayload: PsbtPayload = {
  inputs: [
    {
      txid: "a".repeat(64),
      vout: 0,
      amountSat: 100_000_000,
      address: "bcrt1qcoldwalletexample",
    },
  ],
  outputs: [{ address: "bcrt1qrecipient", amountSat: 99_999_000 }],
  signatures: 0,
  fee: 1_000,
};

describe("psbt-envelope", () => {
  it("encodes and decodes a payload round-trip", () => {
    const enc = encodePsbt(samplePayload);
    const dec = decodePsbt(enc);
    expect(dec.outputs[0]?.address).toBe("bcrt1qrecipient");
    expect(dec.outputs[0]?.amountSat).toBe(99_999_000);
    expect(dec.signatures).toBe(0);
  });

  it("addSignature increments the signature count", () => {
    const enc = encodePsbt(samplePayload);
    const once = addSignature(enc);
    const twice = addSignature(once);
    expect(decodePsbt(once).signatures).toBe(1);
    expect(decodePsbt(twice).signatures).toBe(2);
  });

  it("strips a leading preamble before the marker", () => {
    const enc = "draft-header-metadata\n" + encodePsbt(samplePayload);
    const dec = decodePsbt(enc);
    expect(dec.outputs[0]?.address).toBe("bcrt1qrecipient");
  });
});
