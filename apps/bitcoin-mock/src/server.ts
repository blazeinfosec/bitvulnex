import express from "express";
import type { Request, Response } from "express";
import type {
  JsonRpcRequest,
  JsonRpcResponse,
} from "@bvbe/bitcoin-rpc-types";
import { rpcHandlers } from "./rpc/index.js";
import { chain } from "./state.js";

const app = express();
app.use(express.json({ limit: "1mb" }));

app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "bitcoin-mock", phase: 3 });
});

// --- JSON-RPC mount ---
app.post("/", async (req: Request, res: Response) => {
  const body = req.body as JsonRpcRequest;
  const handler = rpcHandlers[body?.method as keyof typeof rpcHandlers];
  if (!handler) {
    res.status(404).json({
      jsonrpc: "2.0",
      id: body?.id ?? null,
      error: { code: -32601, message: `Method not found: ${body?.method}` },
    } satisfies JsonRpcResponse);
    return;
  }
  try {
    const result = await handler(body.params);
    res.json({ jsonrpc: "2.0", id: body.id, result } satisfies JsonRpcResponse);
  } catch (e) {
    res.status(500).json({
      jsonrpc: "2.0",
      id: body?.id ?? null,
      error: {
        code: -32603,
        message: e instanceof Error ? e.message : "internal error",
      },
    } satisfies JsonRpcResponse);
  }
});

// --- Test affordances ---
// These are not bitcoin RPC; they are lab-only helpers the web app
// proxies to from /api/v2/dev/btc/*. The bitcoin-mock container has
// no host port mapping so trainees cannot hit these directly from
// outside the docker network.

app.post("/test/send", (req, res) => {
  const { address, amountBtc } = req.body as {
    address: string;
    amountBtc: number;
  };
  const amountSat = BigInt(Math.round(Number(amountBtc) * 1e8));
  const txid = chain.labSend(address, amountSat, true);
  res.json({ txid });
});

app.post("/test/mine", (req, res) => {
  const { blocks } = req.body as { blocks: number };
  const hashes = chain.mineBlocks(Number(blocks) || 1);
  res.json({ blocks: hashes.length, height: chain.blockHeight });
});

app.post("/test/rbf", (req, res) => {
  const { txid, newAddress } = req.body as { txid: string; newAddress: string };
  const replacementTxid = chain.rbfReplace(txid, newAddress);
  res.json({ replacementTxid });
});

// Worker-facing: list deposits to a watched address. Phase 3
// worker polls this on a short interval.
app.get("/watch/:address", (req, res) => {
  const txs = chain.txsToAddress(req.params.address).map((t) => ({
    txid: t.txid,
    vout: t.vout,
    amountBtc: Number(t.amountSat) / 1e8,
    confirmations: chain.confirmations(t.txid),
  }));
  res.json({ address: req.params.address, txs });
});

const port = Number(process.env.PORT ?? 18443);
app.listen(port, () => {
  console.log(`[bitcoin-mock] regtest semantics live on :${port}`);
  console.log(
    `[bitcoin-mock] lab wallet pre-funded with ${chain.labWalletUtxos.length} UTXOs`,
  );
});
