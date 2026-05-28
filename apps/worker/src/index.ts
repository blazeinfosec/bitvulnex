// BullMQ worker — Phase 3 registers the deposit-poll queue.

import { Queue, Worker, QueueEvents } from "bullmq";
import { pollOnce, type RpcClient, type WatchTx } from "./deposit-watcher.js";

const redisUrl = process.env.REDIS_URL ?? "redis://redis:6379";
const mockUrl = process.env.BITCOIN_MOCK_URL ?? "http://bitcoin-mock:18443";

function parseRedisUrl(url: string) {
  const u = new URL(url);
  return {
    host: u.hostname,
    port: Number(u.port || 6379),
    ...(u.password ? { password: u.password } : {}),
    maxRetriesPerRequest: null,
  } as const;
}

const connection = parseRedisUrl(redisUrl);

const rpc: RpcClient = {
  async watch(address: string) {
    const res = await fetch(`${mockUrl}/watch/${encodeURIComponent(address)}`);
    if (!res.ok) return { txs: [] };
    const body = (await res.json()) as { txs: WatchTx[] };
    return { txs: body.txs };
  },
};

const QUEUE_NAME = "deposit-poll";

async function main() {
  const queue = new Queue(QUEUE_NAME, { connection });
  const events = new QueueEvents(QUEUE_NAME, { connection });
  events.on("failed", ({ jobId, failedReason }) => {
    console.error(`[worker] job ${jobId} failed:`, failedReason);
  });

  // Repeating job every 5 seconds.
  await queue.add(
    "poll",
    {},
    {
      repeat: { every: 5_000 },
      removeOnComplete: true,
      removeOnFail: 50,
    },
  );

  const worker = new Worker(
    QUEUE_NAME,
    async () => {
      await pollOnce(rpc);
    },
    { connection, concurrency: 1 },
  );
  worker.on("ready", () => console.log("[worker] deposit-poll worker ready"));
  worker.on("error", (err) => console.error("[worker] worker error:", err));

  const shutdown = async (sig: string) => {
    console.log(`[worker] received ${sig}, shutting down...`);
    await worker.close();
    await queue.close();
    await events.close();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((err) => {
  console.error("[worker] fatal:", err);
  process.exit(1);
});
