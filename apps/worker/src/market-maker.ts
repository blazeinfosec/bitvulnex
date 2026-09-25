// Live mock-market feed. Every 2 seconds we walk the price of each
// active TradingPair, write a synthetic trade between the two
// market-maker accounts (mm.alpha ↔ mm.beta), refresh a 5-bid + 5-ask
// order book around the new mid, and fan the result out over Redis
// pub/sub so the WS gateway can stream it to browsers.
//
// IMPORTANT — by design, MM trades are NOT routed through
// apps/web/lib/engine/match.ts. The matching engine's self-trade
// surface (V-25) is preserved exactly: the bot uses two different
// users so its trades are not self-trades. A trainee that places both
// sides of the same pair under one account still bypasses the missing
// self-match filter exactly as Phase 4 planted it.
//
// The fee tier helper is also untouched: MM trades are written with
// fee_bps = 0 (market makers don't pay fees in this lab), but they DO
// contribute to 24h volume aggregates. That's realistic exchange
// noise — V-43 (fee-tier counts cancelled fills) is unaffected because
// MM orders flow to status=filled, not cancelled.

import { Prisma, prisma } from "@bvbe/db";
import { Redis } from "ioredis";

const D = (v: Prisma.Decimal | string | number) => new Prisma.Decimal(v);

// Per-pair random-walk sigma (multiplicative). Numbers below are the
// standard deviation of a single tick's log-return; the resulting
// price walk produces visibly-moving but not noisy charts.
const PAIR_SIGMA: Record<string, number> = {
  "BTC/USDT": 0.0005,
  "BTC/USDC": 0.0005,
  "ETH/USDT": 0.0008,
  "ETH/BTC": 0.0008,
  "LTC/USDT": 0.0012,
  "LTC/BTC": 0.0012,
  "DOGE/USDT": 0.002,
  "USDC/USDT": 0.00005,
};

// Seed start prices for cold-start (no Trade row yet).
const PAIR_SEED_PRICE: Record<string, string> = {
  "BTC/USDT": "67000",
  "BTC/USDC": "67000",
  "ETH/USDT": "3400",
  "ETH/BTC": "0.05074",
  "LTC/USDT": "78",
  "LTC/BTC": "0.001164",
  "DOGE/USDT": "0.12",
  "USDC/USDT": "1.0001",
};

const MM_ALPHA_EMAIL = "mm.alpha@bvbe.local";
const MM_BETA_EMAIL = "mm.beta@bvbe.local";

export type MmDb = Pick<
  typeof prisma,
  "tradingPair" | "trade" | "order" | "balance" | "user" | "$queryRaw"
>;

export type MmPubSub = {
  publish(channel: string, message: string): Promise<unknown>;
};

// Box-Muller transform: turn two U(0,1) into one N(0, sigma).
export function normalSample(sigma: number, rng: () => number = Math.random): number {
  // Avoid log(0) by clamping the first uniform.
  const u1 = Math.max(rng(), 1e-12);
  const u2 = rng();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return z * sigma;
}

// Round `price` to the nearest multiple of `tick` (half-up; tick is the
// price increment).
export function roundToTick(price: Prisma.Decimal, tick: Prisma.Decimal): Prisma.Decimal {
  if (tick.lte(0)) return price;
  // n = round_half_up(price / tick); rounded = n * tick
  const n = price.div(tick).toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP);
  return n.mul(tick);
}

// Uniform random in [a, b].
function uniform(a: number, b: number, rng: () => number = Math.random): number {
  return a + (b - a) * rng();
}

type Quote = { price: string; remaining: string };
type BookSnapshot = { bids: Quote[]; asks: Quote[] };

export type TickResult = {
  pair: string;
  last: string;
  prev: string;
  book: BookSnapshot;
};

async function getMmUserIds(db: MmDb): Promise<[string, string] | null> {
  const [alpha, beta] = await Promise.all([
    db.user.findUnique({ where: { email: MM_ALPHA_EMAIL }, select: { id: true } }),
    db.user.findUnique({ where: { email: MM_BETA_EMAIL }, select: { id: true } }),
  ]);
  if (!alpha || !beta) return null;
  return [alpha.id, beta.id];
}

async function lastTradePrice(db: MmDb, pair: string): Promise<Prisma.Decimal> {
  const last = await db.trade.findFirst({
    where: { pair },
    orderBy: { executedAt: "desc" },
    select: { price: true },
  });
  if (last) return last.price;
  return D(PAIR_SEED_PRICE[pair] ?? "1");
}

// Compute the next price via a log-normal random walk and round to the
// nearest multiple of the pair's price tick. Exposed for tests.
//
// The step is exp(sigma * Z): the log-return is exactly N(0, sigma), so
// the walk has no systematic drift in log space. (A linear `1 + N(0, sigma)`
// shock has E[log] ~= -sigma^2/2 per tick, which at a 2s cadence walks the
// typical path steadily downward over a long session.)
export function nextPrice(
  last: Prisma.Decimal,
  sigma: number,
  tick: Prisma.Decimal,
  rng: () => number = Math.random,
): Prisma.Decimal {
  const shock = Math.exp(normalSample(sigma, rng));
  const raw = last.mul(D(shock));
  const rounded = roundToTick(raw, tick);
  // Never let the price go non-positive (extreme tail of the walk).
  if (rounded.lte(0)) return tick;
  return rounded;
}

type PairRow = {
  base: string;
  quote: string;
  minOrderSize: Prisma.Decimal;
  priceTick: Prisma.Decimal;
};

async function refreshBook(
  db: MmDb,
  pair: string,
  alphaId: string,
  betaId: string,
  pairRow: PairRow,
  midPrice: Prisma.Decimal,
  rng: () => number,
): Promise<BookSnapshot> {
  // Pull every resting MM quote for this pair before re-quoting, so the
  // DB book only ever holds the current generation of levels.
  await db.order.updateMany({
    where: {
      pair,
      userId: { in: [alphaId, betaId] },
      status: { in: ["open", "partial"] },
    },
    data: { status: "cancelled", cancelledAt: new Date() },
  });

  const offsets = [0.0005, 0.0010, 0.0015, 0.0020, 0.0025];
  const min = Number(pairRow.minOrderSize.toString());
  const bids: Quote[] = [];
  const asks: Quote[] = [];
  const ordersToCreate: Prisma.OrderCreateManyInput[] = [];

  for (let i = 0; i < offsets.length; i++) {
    const off = offsets[i] as number;
    const bidPriceRaw = midPrice.mul(D(1 - off));
    const askPriceRaw = midPrice.mul(D(1 + off));
    const bidPrice = roundToTick(bidPriceRaw, pairRow.priceTick);
    const askPrice = roundToTick(askPriceRaw, pairRow.priceTick);

    const bidQty = uniform(min * 5, min * 50, rng);
    const askQty = uniform(min * 5, min * 50, rng);
    const bidQtyStr = bidQty.toFixed(8);
    const askQtyStr = askQty.toFixed(8);

    // Alternate which MM owns each level so neither bid nor ask is
    // monopolised by one user. Even levels: alpha bid / beta ask.
    const bidOwner = i % 2 === 0 ? alphaId : betaId;
    const askOwner = i % 2 === 0 ? betaId : alphaId;

    ordersToCreate.push({
      userId: bidOwner,
      pair,
      side: "buy",
      type: "limit",
      price: bidPrice,
      amount: bidQtyStr,
      filled: "0",
      status: "open",
      feeTier: "base",
    });
    ordersToCreate.push({
      userId: askOwner,
      pair,
      side: "sell",
      type: "limit",
      price: askPrice,
      amount: askQtyStr,
      filled: "0",
      status: "open",
      feeTier: "base",
    });

    // Match the public REST book shape ({price, remaining}) so WS
    // consumers and HTTP consumers see the same level structure.
    bids.push({ price: bidPrice.toString(), remaining: bidQtyStr });
    asks.push({ price: askPrice.toString(), remaining: askQtyStr });
  }

  await db.order.createMany({ data: ordersToCreate });

  return { bids, asks };
}

async function writeSyntheticTrade(
  db: MmDb,
  pair: string,
  pairRow: PairRow,
  alphaId: string,
  betaId: string,
  price: Prisma.Decimal,
  rng: () => number,
): Promise<{ price: string; amount: string; side: "buy" | "sell" }> {
  const min = Number(pairRow.minOrderSize.toString());
  const amt = uniform(min, min * 10, rng);
  const amtStr = amt.toFixed(8);
  // Coin flip: who is taker. Side = taker's side.
  const alphaIsTaker = rng() < 0.5;
  const takerSide: "buy" | "sell" = rng() < 0.5 ? "buy" : "sell";
  const takerUserId = alphaIsTaker ? alphaId : betaId;
  const makerUserId = alphaIsTaker ? betaId : alphaId;

  // Synthesize a pair of (filled) orders so the FK constraints on
  // Trade.takerOrderId / Trade.makerOrderId are satisfied.
  const takerOrder = await db.order.create({
    data: {
      userId: takerUserId,
      pair,
      side: takerSide,
      type: "market",
      price: null,
      amount: amtStr,
      filled: amtStr,
      status: "filled",
      feeTier: "base",
    },
    select: { id: true },
  });
  const makerSide: "buy" | "sell" = takerSide === "buy" ? "sell" : "buy";
  const makerOrder = await db.order.create({
    data: {
      userId: makerUserId,
      pair,
      side: makerSide,
      type: "limit",
      price,
      amount: amtStr,
      filled: amtStr,
      status: "filled",
      feeTier: "base",
    },
    select: { id: true },
  });

  await db.trade.create({
    data: {
      pair,
      takerOrderId: takerOrder.id,
      makerOrderId: makerOrder.id,
      takerUserId,
      makerUserId,
      price,
      amount: amtStr,
      takerFeeBps: 0,
      makerFeeBps: 0,
    },
  });

  // Move the underlying assets between the two MM accounts so the
  // ledger stays internally consistent. Without this, MM balances
  // would drift forever in one direction over a long session.
  //
  // taker buys (base) -> taker.base += amt, taker.quote -= price*amt
  // taker sells -> mirror.
  const notional = price.mul(D(amtStr));
  const base = pairRow.base;
  const quote = pairRow.quote;
  if (takerSide === "buy") {
    await db.balance.update({
      where: { userId_asset: { userId: takerUserId, asset: base } },
      data: { available: { increment: amtStr }, amount: { increment: amtStr } },
    });
    await db.balance.update({
      where: { userId_asset: { userId: takerUserId, asset: quote } },
      data: { available: { decrement: notional }, amount: { decrement: notional } },
    });
    await db.balance.update({
      where: { userId_asset: { userId: makerUserId, asset: base } },
      data: { available: { decrement: amtStr }, amount: { decrement: amtStr } },
    });
    await db.balance.update({
      where: { userId_asset: { userId: makerUserId, asset: quote } },
      data: { available: { increment: notional }, amount: { increment: notional } },
    });
  } else {
    await db.balance.update({
      where: { userId_asset: { userId: takerUserId, asset: base } },
      data: { available: { decrement: amtStr }, amount: { decrement: amtStr } },
    });
    await db.balance.update({
      where: { userId_asset: { userId: takerUserId, asset: quote } },
      data: { available: { increment: notional }, amount: { increment: notional } },
    });
    await db.balance.update({
      where: { userId_asset: { userId: makerUserId, asset: base } },
      data: { available: { increment: amtStr }, amount: { increment: amtStr } },
    });
    await db.balance.update({
      where: { userId_asset: { userId: makerUserId, asset: quote } },
      data: { available: { decrement: notional }, amount: { decrement: notional } },
    });
  }

  return { price: price.toString(), amount: amtStr, side: takerSide };
}

export type TickerRow = {
  pair: string;
  last: string;
  change24h: number;
  vol24h: string;
};

async function computeTickerAll(db: MmDb): Promise<TickerRow[]> {
  const pairs = await db.tradingPair.findMany({ where: { active: true } });
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const rows: TickerRow[] = [];
  for (const tp of pairs) {
    const pair = `${tp.base}/${tp.quote}`;
    // last/open are single-row index lookups; 24h quote volume is summed
    // in Postgres over the (pair, executedAt) index instead of pulling
    // every trade row into the worker each tick.
    const [last, first, volRows] = await Promise.all([
      db.trade.findFirst({
        where: { pair },
        orderBy: { executedAt: "desc" },
        select: { price: true },
      }),
      db.trade.findFirst({
        where: { pair, executedAt: { gte: since } },
        orderBy: { executedAt: "asc" },
        select: { price: true },
      }),
      db.$queryRaw<Array<{ vol: string | null }>>(Prisma.sql`
        SELECT SUM(price * amount)::text AS vol
        FROM trades
        WHERE pair = ${pair} AND "executedAt" >= ${since}
      `),
    ]);
    const lastStr = last?.price?.toString() ?? PAIR_SEED_PRICE[pair] ?? "0";
    const firstNum = Number(first?.price?.toString() ?? lastStr);
    const lastNum = Number(lastStr);
    const change = firstNum > 0 ? ((lastNum - firstNum) / firstNum) * 100 : 0;
    const vol = D(volRows[0]?.vol ?? "0");
    rows.push({
      pair,
      last: lastStr,
      change24h: change,
      vol24h: vol.toString(),
    });
  }
  return rows;
}

export async function runMarketMakerTick(
  db: MmDb = prisma,
  pub: MmPubSub | null = null,
  rng: () => number = Math.random,
): Promise<{ pairs: number }> {
  const ids = await getMmUserIds(db);
  if (!ids) {
    return { pairs: 0 };
  }
  const [alphaId, betaId] = ids;
  const pairs = await db.tradingPair.findMany({ where: { active: true } });
  for (const tp of pairs) {
    const pair = `${tp.base}/${tp.quote}`;
    const sigma = PAIR_SIGMA[pair] ?? 0.0005;
    const last = await lastTradePrice(db, pair);
    const next = nextPrice(last, sigma, tp.priceTick, rng);

    const trade = await writeSyntheticTrade(db, pair, tp, alphaId, betaId, next, rng);
    const book = await refreshBook(db, pair, alphaId, betaId, tp, next, rng);

    if (pub) {
      await pub.publish(
        `book:${pair}`,
        JSON.stringify({ kind: "book", pair, bids: book.bids, asks: book.asks }),
      );
      // Match the RecentTrade shape the client consumes:
      // {id, price:number, size:number, executedAt, takerSide}
      // wrapped in a {kind:"trade", trade:{...}} envelope.
      const tradePx = Number(trade.price);
      const tradeSz = Number(trade.amount);
      await pub.publish(
        `trades:${pair}`,
        JSON.stringify({
          kind: "trade",
          pair,
          trade: {
            id: `mm-${Date.now()}-${Math.floor(rng() * 1_000_000)}`,
            price: Number.isFinite(tradePx) ? tradePx : 0,
            size: Number.isFinite(tradeSz) ? tradeSz : 0,
            executedAt: Date.now(),
            takerSide: trade.side,
          },
        }),
      );
    }
  }

  if (pub) {
    const ticker = await computeTickerAll(db);
    await pub.publish("ticker:all", JSON.stringify({ kind: "ticker", rows: ticker }));
  }

  return { pairs: pairs.length };
}

// Standalone bootstrap used by the BullMQ worker.
export function makeRedisPubSub(redisUrl: string): MmPubSub & { quit(): Promise<void> } {
  const client = new Redis(redisUrl, { maxRetriesPerRequest: null });
  return {
    publish: (channel, message) => client.publish(channel, message),
    quit: async () => {
      await client.quit();
    },
  };
}
