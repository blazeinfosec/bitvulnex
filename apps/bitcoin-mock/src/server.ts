import express from "express";
import type { Request, Response } from "express";
import type {
  JsonRpcRequest,
  JsonRpcResponse,
} from "@bvbe/bitcoin-rpc-types";
import { rpcHandlers } from "./rpc/index.js";

const app = express();
app.use(express.json({ limit: "1mb" }));

app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "bitcoin-mock", phase: 0 });
});

app.post("/", async (req: Request, res: Response) => {
  const body = req.body as JsonRpcRequest;
  const handler = rpcHandlers[body?.method as keyof typeof rpcHandlers];

  if (!handler) {
    const err: JsonRpcResponse = {
      jsonrpc: "2.0",
      id: body?.id ?? null,
      error: { code: -32601, message: `Method not found: ${body?.method}` },
    };
    res.status(404).json(err);
    return;
  }

  try {
    const result = await handler(body.params);
    const ok: JsonRpcResponse = {
      jsonrpc: "2.0",
      id: body.id,
      result,
    };
    res.json(ok);
  } catch (e) {
    const err: JsonRpcResponse = {
      jsonrpc: "2.0",
      id: body?.id ?? null,
      error: {
        code: -32603,
        message: e instanceof Error ? e.message : "internal error",
      },
    };
    res.status(500).json(err);
  }
});

const port = Number(process.env.PORT ?? 18443);
app.listen(port, () => {
  console.log(`[bitcoin-mock] listening on :${port}`);
});
