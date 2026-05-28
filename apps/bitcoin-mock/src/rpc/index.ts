// JSON-RPC handler dispatch. Each method backed by the in-memory
// regtest state defined in `../state.ts`.

import type {
  BlockchainInfo,
  DecodedPsbt,
  RawTransaction,
  WalletProcessPsbtResult,
} from "@bvbe/bitcoin-rpc-types";
import { chain } from "../state.js";

type Params = unknown[] | Record<string, unknown>;

function asArray(params: Params): unknown[] {
  return Array.isArray(params) ? params : Object.values(params ?? {});
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

let derivationCounter = 0;
async function getnewaddress(): Promise<string> {
  derivationCounter += 1;
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

async function sendrawtransaction(): Promise<string> {
  // Phase 3 doesn't accept user-submitted raw TXs; the lab uses
  // /test/send for affordance. Return a placeholder.
  return "0".repeat(64);
}

async function getrawmempool(): Promise<string[]> {
  return Array.from(chain.mempool.keys());
}

async function decodepsbt(): Promise<DecodedPsbt> {
  return { inputs: [], outputs: [] };
}

async function walletprocesspsbt(
  params: Params,
): Promise<WalletProcessPsbtResult> {
  const [psbt] = asArray(params) as [string];
  return { psbt: psbt ?? "", complete: false };
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
} as const;
