// Treasury multi-sig coordinator. Treasury operators draft a PSBT
// consolidating cold-wallet UTXOs into hot-wallet outputs, collect
// 2-of-3 signatures, and broadcast.
//
// The PSBT here uses the Bitvulnex caricature envelope (`BVBE_PSBT_V1:<json>`)
// defined in `@bvbe/shared`. It is NOT a BIP-174 PSBT — the lab uses
// a text envelope so trainees can hand-craft signing flows without
// needing a real PSBT codec.

import { Prisma, prisma as defaultPrisma } from "@bvbe/db";
import {
  decodePsbt,
  encodePsbt,
  type PsbtPayload,
} from "@bvbe/shared";
import { rpc } from "../btc-rpc-client";

export type IntendedOutput = { address: string; amountSat: number };

export class DraftValidationError extends Error {
  readonly status = 400;
}

export class NotFoundError extends Error {
  readonly status = 404;
}

const COLD_WALLET_ADDRESS = "bcrt1qcoldwalletreserveexamplexxxxxx";

export async function createDraft(
  args: {
    authorUserId: string;
    intendedOutputs: IntendedOutput[];
    intentNote?: string;
  },
  db: typeof defaultPrisma = defaultPrisma,
) {
  if (!Array.isArray(args.intendedOutputs) || args.intendedOutputs.length === 0) {
    throw new DraftValidationError("at least one output required");
  }
  for (const o of args.intendedOutputs) {
    if (!o.address || typeof o.address !== "string") {
      throw new DraftValidationError("output missing address");
    }
    if (!Number.isFinite(o.amountSat) || o.amountSat <= 0) {
      throw new DraftValidationError("output amount must be > 0");
    }
  }

  const totalOut = args.intendedOutputs.reduce(
    (acc, o) => acc + o.amountSat,
    0,
  );
  const payload: PsbtPayload = {
    inputs: [
      {
        txid: "0".repeat(64),
        vout: 0,
        amountSat: totalOut + 1_000,
        address: COLD_WALLET_ADDRESS,
      },
    ],
    outputs: args.intendedOutputs,
    signatures: 0,
    fee: 1_000,
  };

  return db.treasuryDraft.create({
    data: {
      authorUserId: args.authorUserId,
      psbtBase64: encodePsbt(payload),
      intentNote: args.intentNote ?? null,
      intendedOutputs: args.intendedOutputs as unknown as Prisma.InputJsonValue,
      status: "drafted",
    },
  });
}

export async function signDraft(
  args: { draftId: string; signerUserId: string },
  db: typeof defaultPrisma = defaultPrisma,
) {
  return db.$transaction(async (tx) => {
    const draft = await tx.treasuryDraft.findUnique({
      where: { id: args.draftId },
    });
    if (!draft) throw new NotFoundError("draft not found");
    if (draft.status !== "drafted" && draft.status !== "partial") {
      throw new DraftValidationError("draft not signable");
    }

    // The mock node walletprocesspsbt returns the envelope with one
    // more signature attached. Real bitcoind would sign with the
    // wallet's keys here; the lab simulates.
    const result = await rpc<{ psbt: string; complete: boolean }>(
      "walletprocesspsbt",
      [draft.psbtBase64],
    );

    await tx.treasurySignature.create({
      data: { draftId: draft.id, signerUserId: args.signerUserId },
    });

    const count = await tx.treasurySignature.count({
      where: { draftId: draft.id },
    });

    return tx.treasuryDraft.update({
      where: { id: draft.id },
      data: {
        psbtBase64: result.psbt,
        status: count >= 2 ? "signed" : "partial",
      },
    });
  });
}

export async function broadcastDraft(
  args: {
    draftId: string;
    broadcasterUserId: string;
    overridePsbt?: string;
  },
  db: typeof defaultPrisma = defaultPrisma,
) {
  const draft = await db.treasuryDraft.findUnique({
    where: { id: args.draftId },
  });
  if (!draft) throw new NotFoundError("draft not found");
  if (draft.status !== "signed") {
    throw new DraftValidationError("draft not signed");
  }

  // The broadcaster may pass an `overridePsbt` to substitute the
  // stored draft envelope — used for edge cases where the stored
  // base64 needs to be re-derived (e.g. recovered from an external
  // signer's offline export). The intended outputs are still
  // enforced from the original draft record below.
  const psbt = args.overridePsbt ?? draft.psbtBase64;

  // Validate that the PSBT's outputs match the canonical intended
  // outputs captured at draft-creation time.
  const decoded = decodePsbt(psbt);
  const intended = draft.intendedOutputs as unknown as IntendedOutput[];
  validateIntendedOutputs(decoded, intended);

  // Finalize the PSBT on the mock to get the wire-format hex, then
  // broadcast.
  const finalized = await rpc<{ hex: string }>("finalizepsbt", [psbt]);
  const txid = await rpc<string>("sendrawtransaction", [finalized.hex]);

  return db.treasuryDraft.update({
    where: { id: draft.id },
    data: {
      status: "broadcast",
      broadcastTxid: txid,
      broadcastAt: new Date(),
    },
  });
}

function validateIntendedOutputs(
  decoded: PsbtPayload,
  intended: IntendedOutput[],
): void {
  if (decoded.outputs.length !== intended.length) {
    throw new DraftValidationError("output count mismatch");
  }
  for (let i = 0; i < intended.length; i++) {
    const d = decoded.outputs[i];
    const want = intended[i];
    if (!d || !want) throw new DraftValidationError("output missing");
    if (d.address !== want.address) {
      throw new DraftValidationError("output address mismatch");
    }
    if (d.amountSat !== want.amountSat) {
      throw new DraftValidationError("output amount mismatch");
    }
  }
}
