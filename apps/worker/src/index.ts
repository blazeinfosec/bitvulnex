// Phase 0: BullMQ worker process boots and stays idle.
// Phase 7 will register the withdrawal queue here.

import IORedis from "ioredis";

const redisUrl = process.env.REDIS_URL ?? "redis://redis:6379";

async function main() {
  const redis = new IORedis(redisUrl, { maxRetriesPerRequest: null });
  await redis.ping();
  console.log("[worker] connected to redis; no queues registered (phase 0)");

  // Keep the process alive.
  setInterval(() => {
    // Idle heartbeat.
  }, 60_000);
}

main().catch((err) => {
  console.error("[worker] fatal:", err);
  process.exit(1);
});
