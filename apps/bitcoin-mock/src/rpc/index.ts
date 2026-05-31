// JSON-RPC handler dispatch. Each method backed by the in-memory
// regtest state defined in `../state.ts`.
//
// Phase 7 extends the surface for the withdrawal worker and the
// treasury coordinator: `sendmany`, `bumpfee`, plus a working
// `decodepsbt` / `walletprocesspsbt` / `finalizepsbt` over the
// Bitvulnex PSBT caricature envelope defined in `@bvbe/shared`.

import type {
  BlockchainInfo,
  DecodedPsbt,
  RawTransaction,
  WalletProcessPsbtResult,
} from "@bvbe/bitcoin-rpc-types";
import {
  PSBT_MARKER,
  addSignature,
  decodePsbt as decodePsbtShared,
} from "@bvbe/shared";
import { randomBytes } from "node:crypto";
import { chain } from "../state.js";

type Params = unknown[] | Record<string, unknown>;

function asArray(params: Params): unknown[] {
  return Array.isArray(params) ? params : Object.values(params ?? {});
}

function randomHex(bytes: number): string {
  return randomBytes(bytes).toString("hex");
}

async function getblockchaininfo(): Promise<BlockchainInfo> {
  return {
    chain: "regtest",
    blocks: chain.blockHeight,
    headers: chain.blockHeight,
    bestblockhash: chain.bestBlockHash,
    mediantime: Math.floor(Date.now() / 1000),
  };
}

async function generatetoaddress(params: Params): Promise<string[]> {
  const [count] = asArray(params) as [number];
  return chain.mineBlocks(Number(count) || 1);
}

async function getnewaddress(): Promise<string> {
  return chain.newAddress("bcrt1q");
}

async function gettransaction(params: Params): Promise<RawTransaction> {
  const [txid] = asArray(params) as [string];
  return {
    txid: txid ?? "",
    hex: "",
    confirmations: chain.confirmations(txid ?? ""),
  };
}

async function sendrawtransaction(params: Params): Promise<string> {
  const [rawHex] = asArray(params) as [string];
  // The mock treats the raw hex as opaque. We synthesize a txid and
  // queue the TX as a pending mempool entry that will confirm at the
  // next mined block. Outputs are parsed back out of the lab's
  // RAWTX:<json> envelope when present so the chain state reflects
  // the broadcast (used by the treasury flow).
  const txid = randomHex(32);
  let outputs: Array<{ address: string; amountSat: bigint }> = [];
  if (typeof rawHex === "string" && rawHex.startsWith("RAWTX:")) {
    try {
      const parsed = JSON.parse(rawHex.slice("RAWTX:".length)) as Array<{
        address: string;
        amountSat: number;
      }>;
      outputs = parsed.map((o) => ({
        address: o.address,
        amountSat: BigInt(o.amountSat),
      }));
    } catch {
      // fall through with empty outputs — chain treats it as a no-op TX
    }
  }
  chain.admitRawTx(txid, outputs);
  return txid;
}

async function getrawmempool(): Promise<string[]> {
  return Array.from(chain.mempool.keys());
}

async function decodepsbt(params: Params): Promise<DecodedPsbt> {
  const [psbt] = asArray(params) as [string];
  const payload = decodePsbtShared(psbt);
  return {
    inputs: payload.inputs.map((i) => ({
      txid: i.txid,
      vout: i.vout,
      value: i.amountSat,
    })),
    outputs: payload.outputs.map((o) => ({
      address: o.address,
      value: o.amountSat,
    })),
    fee: payload.fee,
  };
}

async function walletprocesspsbt(
  params: Params,
): Promise<WalletProcessPsbtResult> {
  const [psbt] = asArray(params) as [string];
  const signed = addSignature(psbt);
  const payload = decodePsbtShared(signed);
  return { psbt: signed, complete: payload.signatures >= 2 };
}

async function finalizepsbt(params: Params): Promise<{ hex: string }> {
  const [psbtRaw] = asArray(params) as [string];
  // Canonicalize to the final envelope segment to handle drafts that
  // accumulated metadata preambles during the signing roundtrips. A
  // well-formed single-envelope PSBT is unchanged by this step.
  const segs = psbtRaw.split(PSBT_MARKER);
  const canonical = PSBT_MARKER + segs[segs.length - 1];
  const payload = decodePsbtShared(canonical);
  return { hex: "RAWTX:" + JSON.stringify(payload.outputs) };
}

async function sendmany(params: Params): Promise<string> {
  // sendmany({addr: btcAmountStr}, feeSat) — used by the withdrawal
  // worker. Spends from the lab wallet and credits each recipient.
  const args = asArray(params);
  const recipients = (args[0] ?? {}) as Record<string, string | number>;
  for (const [address, amount] of Object.entries(recipients)) {
    const amountSat = BigInt(
      Math.round(Number(amount) * 100_000_000),
    );
    return chain.labSend(address, amountSat, true);
  }
  throw new Error("sendmany: no recipients");
}

async function bumpfee(
  params: Params,
): Promise<{ txid: string; origfee: number; fee: number }> {
  const args = asArray(params);
  const oldTxid = String(args[0] ?? "");
  const old = chain.mempool.get(oldTxid);
  if (!old) throw new Error("tx not in mempool");
  // The mock's RBF helper already supports a destination override; for
  // a "true" RBF (just bump the fee, keep outputs), we re-point the
  // replacement at the same recipient as the original output.
  const dest = old.outputs[0]?.address ?? chain.labWalletAddress;
  const replacementTxid = chain.rbfReplace(oldTxid, dest);
  const replacement = chain.mempool.get(replacementTxid);
  return {
    txid: replacementTxid,
    origfee: Number(old.feeSat),
    fee: Number(replacement?.feeSat ?? old.feeSat),
  };
}

export const rpcHandlers = {
  getblockchaininfo,
  generatetoaddress,
  getnewaddress,
  gettransaction,
  sendrawtransaction,
  getrawmempool,
  decodepsbt,
  walletprocesspsbt,
  finalizepsbt,
  sendmany,
  bumpfee,
} as const;
