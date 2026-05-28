// BullMQ worker — Phase 4 adopts the upsertJobScheduler API and
// passes a shared IORedis instance to all BullMQ constructors.

import { Redis } from "ioredis";
import { Queue, Worker, QueueEvents } from "bullmq";
import { pollOnce, type RpcClient, type WatchTx } from "./deposit-watcher.js";

const redisUrl = process.env.REDIS_URL ?? "redis://redis:6379";
const mockUrl = process.env.BITCOIN_MOCK_URL ?? "http://bitcoin-mock:18443";

// Single shared connection. ioredis fully parses the URL (including
// password, db number, rediss://) so we don't hand-roll a partial
// parser. Phase-3 L7 Q-3.8 fix-up.
const connection = new Redis(redisUrl, { maxRetriesPerRequest: null });

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

  // BullMQ v5: use upsertJobScheduler (the queue.add+repeat form is
  // deprecated). The scheduler key is deterministic; repeated calls
  // across worker restarts are idempotent. Phase-3 L7 Q-3.7 fix-up.
  await queue.upsertJobScheduler(
    "deposit-poll-scheduler",
    { every: 5_000 },
    { name: "poll", data: {}, opts: { removeOnComplete: true, removeOnFail: 50 } },
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
    await connection.quit();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((err) => {
  console.error("[worker] fatal:", err);
  process.exit(1);
});
