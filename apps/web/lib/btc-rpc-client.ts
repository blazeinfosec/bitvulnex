import { env } from "./env";

type JsonRpcResult = { result?: unknown; error?: { message: string } };

export async function rpc<T>(method: string, params: unknown[] = []): Promise<T> {
  const res = await fetch(env().BITCOIN_MOCK_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const body = (await res.json()) as JsonRpcResult;
  if (body.error) throw new Error(`bitcoind: ${body.error.message}`);
  return body.result as T;
}

export async function callMockAffordance<T>(
  path: string,
  body: unknown,
): Promise<T> {
  const url = `${env().BITCOIN_MOCK_URL}${path}`;
  const init: RequestInit =
    body === undefined
      ? { method: "POST" }
      : {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        };
  const res = await fetch(url, init);
  if (!res.ok) throw new Error(`mock ${path}: ${res.status}`);
  return (await res.json()) as T;
}
