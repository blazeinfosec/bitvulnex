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

// Raised when the mock node is unreachable or rejects the call.
// `status` is what the dev route should answer with: 400 when the
// mock rejected the request itself, 502 when the mock is down or
// failed.
export class MockAffordanceError extends Error {
  constructor(
    message: string,
    public status: 400 | 502,
  ) {
    super(message);
  }
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
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch {
    throw new MockAffordanceError(`mock ${path}: unreachable`, 502);
  }
  if (!res.ok) {
    throw new MockAffordanceError(
      `mock ${path}: ${res.status}`,
      res.status >= 400 && res.status < 500 ? 400 : 502,
    );
  }
  try {
    return (await res.json()) as T;
  } catch {
    throw new MockAffordanceError(`mock ${path}: bad response`, 502);
  }
}
