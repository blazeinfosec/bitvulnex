// BullMQ worker — Phase 5 adds the liquidation-poll queue alongside
// Phase 3's deposit-poll.

import { Redis } from "ioredis";
import { Queue, Worker } from "bullmq";
import { prisma } from "@bvbe/db";
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
import { snapshotOnce } from "./equity-snapshot.js";
import { simulateActivityTick } from "./activity-sim.js";

const redisUrl = process.env.REDIS_URL ?? "redis://redis:6379";
const mockUrl = process.env.BITCOIN_MOCK_URL ?? "http://bitcoin-mock:18443";
const webUrl = process.env.WEB_INTERNAL_URL ?? "http://web:3000";

const connection = new Redis(redisUrl, { maxRetriesPerRequest: null });

const rpc: RpcClient = {
  async watch(address: string) {
    const res = await fetch(`${mockUrl}/watch/${encodeURIComponent(address)}`);
    if (!res.ok) throw new Error(`watch ${address}: HTTP ${res.status}`);
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
const EQUITY_SNAPSHOT_QUEUE = "equity-snapshot";
const ACTIVITY_SIM_QUEUE = "activity-sim";

// Ambient-activity simulator cadence + on/off. Default on so the lab
// feels live; set ACTIVITY_SIM_ENABLED=false to freeze it for a
// deterministic demo.
const ACTIVITY_SIM_ENABLED = process.env.ACTIVITY_SIM_ENABLED !== "false";
const ACTIVITY_SIM_EVERY_MS = Number(
  process.env.ACTIVITY_SIM_EVERY_MS ?? 20_000,
);

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
  const equitySnapshotQueue = new Queue(EQUITY_SNAPSHOT_QUEUE, { connection });
  const activitySimQueue = new Queue(ACTIVITY_SIM_QUEUE, { connection });

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
  // Equity snapshots — runs every 5 minutes so demos see the curve
  // move. Production would run nightly at 00:05 UTC.
  await equitySnapshotQueue.upsertJobScheduler(
    "equity-snapshot-scheduler",
    { every: 300_000 },
    {
      name: "snapshot",
      data: {},
      opts: { removeOnComplete: true, removeOnFail: 50 },
    },
  );

  if (ACTIVITY_SIM_ENABLED) {
    await activitySimQueue.upsertJobScheduler(
      "activity-sim-scheduler",
      { every: ACTIVITY_SIM_EVERY_MS },
      { name: "tick", data: {}, opts: { removeOnComplete: true, removeOnFail: 50 } },
    );
  } else {
    // Schedulers persist in Redis across restarts; drop any left over
    // from a previous run so the simulator actually stays frozen.
    await activitySimQueue.removeJobScheduler("activity-sim-scheduler");
  }

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

  const equitySnapshotWorker = new Worker(
    EQUITY_SNAPSHOT_QUEUE,
    async () => {
      await snapshotOnce();
    },
    { connection, concurrency: 1 },
  );
  equitySnapshotWorker.on("ready", () =>
    console.log("[worker] equity-snapshot ready"),
  );
  equitySnapshotWorker.on("error", (err) =>
    console.error("[worker] equity-snapshot error:", err),
  );

  const activitySimWorker = new Worker(
    ACTIVITY_SIM_QUEUE,
    async () => {
      const { actions } = await simulateActivityTick();
      if (actions.length > 0) {
        console.log(`[worker] activity-sim: ${actions.join(", ")}`);
      }
    },
    { connection, concurrency: 1 },
  );
  activitySimWorker.on("ready", () =>
    console.log("[worker] activity-sim ready"),
  );
  activitySimWorker.on("error", (err) =>
    console.error("[worker] activity-sim error:", err),
  );

  const workers: Array<[string, Worker]> = [
    [DEPOSIT_QUEUE, depositWorker],
    [LIQUIDATION_QUEUE, liquidationWorker],
    [YIELD_QUEUE, yieldWorker],
    [STAKING_QUEUE, stakingWorker],
    [WITHDRAWAL_QUEUE, withdrawalWorker],
    [MARKET_MAKER_QUEUE, marketMakerWorker],
    [EQUITY_SNAPSHOT_QUEUE, equitySnapshotWorker],
    [ACTIVITY_SIM_QUEUE, activitySimWorker],
  ];
  // "error" only covers worker/connection-level faults; a throwing job
  // processor surfaces as "failed", so log those too.
  for (const [name, w] of workers) {
    w.on("failed", (job, err) =>
      console.error(`[worker] ${name} job ${job?.id ?? "?"} failed:`, err),
    );
  }

  let shuttingDown = false;
  const shutdown = async (sig: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[worker] received ${sig}, shutting down...`);
    let exitCode = 0;
    try {
      await Promise.all([
        ...workers.map(([, w]) => w.close()),
        depositQueue.close(),
        liquidationQueue.close(),
        yieldQueue.close(),
        stakingQueue.close(),
        withdrawalQueue.close(),
        marketMakerQueue.close(),
        equitySnapshotQueue.close(),
        activitySimQueue.close(),
      ]);
    } catch (err) {
      console.error("[worker] error closing queues/workers:", err);
      exitCode = 1;
    } finally {
      const results = await Promise.allSettled([
        mmPub.quit(),
        connection.quit(),
        prisma.$disconnect(),
      ]);
      for (const r of results) {
        if (r.status === "rejected") {
          console.error("[worker] error closing connection:", r.reason);
          exitCode = 1;
        }
      }
      process.exit(exitCode);
    }
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((err) => {
  console.error("[worker] fatal:", err);
  process.exit(1);
});
