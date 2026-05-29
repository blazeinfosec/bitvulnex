// BullMQ worker — Phase 5 adds the liquidation-poll queue alongside
// Phase 3's deposit-poll.

import { Redis } from "ioredis";
import { Queue, Worker, QueueEvents } from "bullmq";
import { pollOnce, type RpcClient, type WatchTx } from "./deposit-watcher.js";
import {
  pollLiquidations,
  type PriceClient,
} from "./liquidation-watcher.js";
import { accrueOnce } from "./yield-accrual.js";
import { materializeStakingClaims } from "./staking-rewards.js";
import {
  processWithdrawalOnce,
  type BitcoinClient,
} from "./withdrawal-processor.js";
import { runMarketMakerTick, makeRedisPubSub } from "./market-maker.js";

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
const YIELD_QUEUE = "yield-accrual";
const STAKING_QUEUE = "staking-rewards";
const WITHDRAWAL_QUEUE = "withdrawal-process";
const MARKET_MAKER_QUEUE = "market-maker";

async function rpcCall<T>(method: string, params: unknown[]): Promise<T> {
  const res = await fetch(mockUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const body = (await res.json()) as {
    result?: unknown;
    error?: { message: string };
  };
  if (body.error) throw new Error(`bitcoind: ${body.error.message}`);
  return body.result as T;
}

const bitcoin: BitcoinClient = {
  async sendmany(addressToAmount, feeSat) {
    return rpcCall<string>("sendmany", [addressToAmount, feeSat]);
  },
  async gettransaction(txid) {
    return rpcCall<{ confirmations: number }>("gettransaction", [txid]);
  },
};

async function main() {
  const mmPub = makeRedisPubSub(redisUrl);

  const depositQueue = new Queue(DEPOSIT_QUEUE, { connection });
  const liquidationQueue = new Queue(LIQUIDATION_QUEUE, { connection });
  const yieldQueue = new Queue(YIELD_QUEUE, { connection });
  const stakingQueue = new Queue(STAKING_QUEUE, { connection });
  const withdrawalQueue = new Queue(WITHDRAWAL_QUEUE, { connection });
  const marketMakerQueue = new Queue(MARKET_MAKER_QUEUE, { connection });
  const depositEvents = new QueueEvents(DEPOSIT_QUEUE, { connection });
  const liquidationEvents = new QueueEvents(LIQUIDATION_QUEUE, { connection });
  const yieldEvents = new QueueEvents(YIELD_QUEUE, { connection });
  const stakingEvents = new QueueEvents(STAKING_QUEUE, { connection });
  const withdrawalEvents = new QueueEvents(WITHDRAWAL_QUEUE, { connection });
  const marketMakerEvents = new QueueEvents(MARKET_MAKER_QUEUE, { connection });

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
  await yieldQueue.upsertJobScheduler(
    "yield-accrual-scheduler",
    { every: 60_000 },
    { name: "accrue", data: {}, opts: { removeOnComplete: true, removeOnFail: 50 } },
  );
  await stakingQueue.upsertJobScheduler(
    "staking-rewards-scheduler",
    { every: 60_000 },
    { name: "rewards", data: {}, opts: { removeOnComplete: true, removeOnFail: 50 } },
  );
  await withdrawalQueue.upsertJobScheduler(
    "withdrawal-process-scheduler",
    { every: 5_000 },
    { name: "process", data: {}, opts: { removeOnComplete: true, removeOnFail: 50 } },
  );
  await marketMakerQueue.upsertJobScheduler(
    "market-maker-scheduler",
    { every: 2_000 },
    { name: "tick", data: {}, opts: { removeOnComplete: true, removeOnFail: 50 } },
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

  const yieldWorker = new Worker(
    YIELD_QUEUE,
    async () => {
      await accrueOnce();
    },
    { connection, concurrency: 1 },
  );
  yieldWorker.on("ready", () => console.log("[worker] yield-accrual ready"));
  yieldWorker.on("error", (err) =>
    console.error("[worker] yield-accrual error:", err),
  );

  const stakingWorker = new Worker(
    STAKING_QUEUE,
    async () => {
      await materializeStakingClaims();
    },
    { connection, concurrency: 1 },
  );
  stakingWorker.on("ready", () =>
    console.log("[worker] staking-rewards ready"),
  );
  stakingWorker.on("error", (err) =>
    console.error("[worker] staking-rewards error:", err),
  );

  const withdrawalWorker = new Worker(
    WITHDRAWAL_QUEUE,
    async () => {
      await processWithdrawalOnce(bitcoin);
    },
    { connection, concurrency: 1 },
  );
  withdrawalWorker.on("ready", () =>
    console.log("[worker] withdrawal-process ready"),
  );
  withdrawalWorker.on("error", (err) =>
    console.error("[worker] withdrawal-process error:", err),
  );

  const marketMakerWorker = new Worker(
    MARKET_MAKER_QUEUE,
    async () => {
      await runMarketMakerTick(undefined, mmPub);
    },
    { connection, concurrency: 1 },
  );
  marketMakerWorker.on("ready", () =>
    console.log("[worker] market-maker ready"),
  );
  marketMakerWorker.on("error", (err) =>
    console.error("[worker] market-maker error:", err),
  );

  const shutdown = async (sig: string) => {
    console.log(`[worker] received ${sig}, shutting down...`);
    await Promise.all([
      depositWorker.close(),
      liquidationWorker.close(),
      yieldWorker.close(),
      stakingWorker.close(),
      withdrawalWorker.close(),
      marketMakerWorker.close(),
      depositQueue.close(),
      liquidationQueue.close(),
      yieldQueue.close(),
      stakingQueue.close(),
      withdrawalQueue.close(),
      marketMakerQueue.close(),
      depositEvents.close(),
      liquidationEvents.close(),
      yieldEvents.close(),
      stakingEvents.close(),
      withdrawalEvents.close(),
      marketMakerEvents.close(),
    ]);
    await mmPub.quit();
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
