// WS gateway. Fans Redis pub/sub channels out to connected WebSocket
// clients. Browser pages connect to ws://exchange.local/ws and
// subscribe to channels by name.

import { createServer } from "node:http";
import { Redis } from "ioredis";
import { WebSocketServer, type WebSocket } from "ws";
import { verifyAccessToken } from "@bvbe/shared";

const redisUrl = process.env.REDIS_URL ?? "redis://redis:6379";
const port = Number(process.env.PORT ?? 3001);
const jwtSecret = process.env.JWT_SECRET;
if (!jwtSecret || jwtSecret.length < 32) {
  throw new Error("JWT_SECRET required");
}

type ClientState = {
  ws: WebSocket;
  userId: string | null;
  subscriptions: Set<string>;
};

const clients = new Set<ClientState>();
const sub = new Redis(redisUrl, { maxRetriesPerRequest: null });

// Phase 10 slice 2 adds `ticker:all` (compact 24h-summary feed used by
// the chyron and Markets page) and `chart:<pair>:<tf>` (candle feed
// the trading view consumes in slice 4). Both are public broadcast
// channels — same fanout shape as `book:*` and `trades:*`. The
// connection handshake (lines 50-79) is intentionally unchanged.
const PUBSUB_PATTERNS = [
  "book:*",
  "trades:*",
  "private:*",
  "ticker:*",
  "chart:*",
];

async function startRedisListener() {
  await sub.psubscribe(...PUBSUB_PATTERNS);
  sub.on("pmessage", (_pattern, channel, message) => {
    for (const c of clients) {
      if (c.subscriptions.has(channel)) {
        try {
          c.ws.send(message);
        } catch {
          /* client gone */
        }
      }
    }
  });
}

const http = createServer((_req, res) => {
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify({ service: "ws-gateway", phase: 4 }));
});

const wss = new WebSocketServer({ noServer: true });

http.on("upgrade", async (req, socket, head) => {
  // The raw socket has no error listener until `ws` takes it over; a
  // client reset while we're awaiting token verification would otherwise
  // surface as an unhandled 'error' event and kill the process.
  const onSocketError = (err: Error) => {
    console.warn("[ws-gateway] upgrade socket error:", err.message);
    socket.destroy();
  };
  socket.on("error", onSocketError);

  const url = new URL(req.url ?? "/", "http://localhost");
  if (url.pathname !== "/ws" && url.pathname !== "/") {
    socket.destroy();
    return;
  }

  // Pull the access token from the query string. (Browsers don't
  // send Authorization on WS upgrade, so we ship it here.)
  const token = url.searchParams.get("token");
  let userId: string | null = null;
  if (token) {
    try {
      const claims = await verifyAccessToken(token, jwtSecret);
      userId = claims.sub;
    } catch {
      userId = null;
    }
  }

  if (socket.destroyed) return;
  wss.handleUpgrade(req, socket, head, (ws) => {
    socket.off("error", onSocketError);
    ws.on("error", (err) =>
      console.warn("[ws-gateway] client socket error:", err.message),
    );
    const state: ClientState = { ws, userId, subscriptions: new Set() };
    clients.add(state);
    ws.on("message", (raw) => handleMessage(state, raw.toString()));
    ws.on("close", () => clients.delete(state));
    ws.send(
      JSON.stringify({ kind: "hello", userId, at: new Date().toISOString() }),
    );
  });
});

function handleMessage(state: ClientState, raw: string): void {
  let msg: { kind?: string; channel?: string };
  try {
    msg = JSON.parse(raw);
  } catch {
    return;
  }
  if (msg.kind === "subscribe" && msg.channel) {
    // Subscribe the client to any channel name they ask for. The
    // private:<userId> channels carry per-user order/balance events;
    // public book/trades channels are broadcasts.
    state.subscriptions.add(msg.channel);
    state.ws.send(JSON.stringify({ kind: "subscribed", channel: msg.channel }));
    return;
  }
  if (msg.kind === "unsubscribe" && msg.channel) {
    state.subscriptions.delete(msg.channel);
    return;
  }
}

startRedisListener()
  .then(() => {
    http.listen(port, () => {
      console.log(`[ws-gateway] listening on :${port}`);
    });
  })
  .catch((err) => {
    console.error("[ws-gateway] failed to start Redis listener:", err);
    process.exit(1);
  });
