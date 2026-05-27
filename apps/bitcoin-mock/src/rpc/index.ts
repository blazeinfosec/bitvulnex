// Phase 0 ships well-typed stubs that return realistic fixtures.
// Phase 3 onward fills in regtest semantics (UTXO tracking, block
// progression, mempool, RBF, etc.).

import type {
  BlockchainInfo,
  DecodedPsbt,
  RawTransaction,
  WalletProcessPsbtResult,
} from "@bvbe/bitcoin-rpc-types";

type Params = unknown[] | Record<string, unknown>;

function asArray(params: Params): unknown[] {
  return Array.isArray(params) ? params : Object.values(params ?? {});
}

const ZERO_HASH = "0".repeat(64);

async function getblockchaininfo(): Promise<BlockchainInfo> {
  return {
    chain: "regtest",
    blocks: 0,
    headers: 0,
    bestblockhash: ZERO_HASH,
    mediantime: Math.floor(Date.now() / 1000),
  };
}

async function generatetoaddress(params: Params): Promise<string[]> {
  const [count] = asArray(params) as [number];
  return Array.from({ length: count ?? 1 }, (_, i) =>
    i.toString(16).padStart(64, "0"),
  );
}

async function getnewaddress(): Promise<string> {
  // Phase 0 stub: returns a fixed regtest-style placeholder. Phase 3
  // implements HD derivation off a deterministic mock seed.
  return "bcrt1qphase0placeholderaddressxxxxxxxxxxxxxxx";
}

async function gettransaction(params: Params): Promise<RawTransaction> {
  const [txid] = asArray(params) as [string];
  return {
    txid: txid ?? ZERO_HASH,
    hex: "",
    confirmations: 0,
  };
}

async function sendrawtransaction(): Promise<string> {
  return ZERO_HASH;
}

async function getrawmempool(): Promise<string[]> {
  return [];
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
