export type JsonRpcRequest = {
  jsonrpc: "1.0" | "2.0";
  id: string | number | null;
  method: string;
  params: unknown[] | Record<string, unknown>;
};

export type JsonRpcResponse<T = unknown> =
  | { jsonrpc: "1.0" | "2.0"; id: string | number | null; result: T }
  | {
      jsonrpc: "1.0" | "2.0";
      id: string | number | null;
      error: { code: number; message: string };
    };

export type BlockchainInfo = {
  chain: "regtest";
  blocks: number;
  headers: number;
  bestblockhash: string;
  mediantime: number;
};

export type Address = string;
export type Txid = string;

export type RawTransaction = {
  txid: Txid;
  hex: string;
  confirmations: number;
  blockhash?: string;
};

export type DecodedPsbt = {
  inputs: Array<{ txid: Txid; vout: number; value?: number }>;
  outputs: Array<{ address?: Address; value: number }>;
  fee?: number;
};

export type WalletProcessPsbtResult = {
  psbt: string;
  complete: boolean;
};

export type RpcMethod =
  | "getblockchaininfo"
  | "generatetoaddress"
  | "getnewaddress"
  | "gettransaction"
  | "sendrawtransaction"
  | "getrawmempool"
  | "decodepsbt"
  | "walletprocesspsbt";
