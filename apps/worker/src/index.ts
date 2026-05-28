// BullMQ worker — Phase 5 adds the liquidation-poll queue alongside
// Phase 3's deposit-poll.

import { Redis } from "ioredis";
import { Queue, Worker, QueueEvents } from "bullmq";
import { pollOnce, type RpcClient, type WatchTx } from "./deposit-watcher.js";
import {
  pollLiquidations,
  type PriceClient,
} from "./liquidation-watcher.js";

const redisUrl = process.env.REDIS_URL ?? "redis://redis:6379";
const mockUrl = process.env.BITCOIN_MOCK_URL ?? "http://bitcoin-mock:18443";
const webUrl = process.env.WEB_INTERNAL_URL ?? "http://web:3000";

const connection = new Redis(redisUrl, { maxRetriesPerRequest: null });

const rpc: RpcClient = {
  async watch(address: string) {
    const res = await fetch(`${mockUrl}/watch/${encodeURIComponent(address)}`);
    if (!res.ok) return { txs: [] };
    const body = (await res.json()) as { txs: WatchTx[] };
    return { txs: body.txs };
  },
};

const pricer: PriceClient = {
  async getPrice(pair: string) {
    const res = await fetch(
      `${webUrl}/api/v2/public/price/${encodeURIComponent(pair)}`,
    );
    if (!res.ok) return { last: null };
    const body = (await res.json()) as { last: string | null };
    return { last: body.last };
  },
};

const DEPOSIT_QUEUE = "deposit-poll";
const LIQUIDATION_QUEUE = "liquidation-poll";

async function main() {
  const depositQueue = new Queue(DEPOSIT_QUEUE, { connection });
  const liquidationQueue = new Queue(LIQUIDATION_QUEUE, { connection });
  const depositEvents = new QueueEvents(DEPOSIT_QUEUE, { connection });
  const liquidationEvents = new QueueEvents(LIQUIDATION_QUEUE, { connection });

  await depositQueue.upsertJobScheduler(
    "deposit-poll-scheduler",
    { every: 5_000 },
    { name: "poll", data: {}, opts: { removeOnComplete: true, removeOnFail: 50 } },
  );
  await liquidationQueue.upsertJobScheduler(
    "liquidation-poll-scheduler",
    { every: 2_000 },
    { name: "poll", data: {}, opts: { removeOnComplete: true, removeOnFail: 50 } },
  );

  const depositWorker = new Worker(
    DEPOSIT_QUEUE,
    async () => {
      await pollOnce(rpc);
    },
    { connection, concurrency: 1 },
  );
  depositWorker.on("ready", () =>
    console.log("[worker] deposit-poll ready"),
  );
  depositWorker.on("error", (err) =>
    console.error("[worker] deposit error:", err),
  );

  const liquidationWorker = new Worker(
    LIQUIDATION_QUEUE,
    async () => {
      await pollLiquidations(pricer);
    },
    { connection, concurrency: 1 },
  );
  liquidationWorker.on("ready", () =>
    console.log("[worker] liquidation-poll ready"),
  );
  liquidationWorker.on("error", (err) =>
    console.error("[worker] liquidation error:", err),
  );

  const shutdown = async (sig: string) => {
    console.log(`[worker] received ${sig}, shutting down...`);
    await Promise.all([
      depositWorker.close(),
      liquidationWorker.close(),
      depositQueue.close(),
      liquidationQueue.close(),
      depositEvents.close(),
      liquidationEvents.close(),
    ]);
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
