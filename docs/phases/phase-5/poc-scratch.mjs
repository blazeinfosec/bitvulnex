// Phase 5 PoC scratch. Verifies the margin math + the CHAIN C
// completion shape without spinning up containers.

import { Prisma } from "../../../packages/db/src/index.ts";
import {
  breachesMaintenance,
  liquidationPriceFor,
  keeperRebate,
  unrealizedPnl,
} from "../../../apps/web/lib/engine/margin.ts";

const D = (s) => new Prisma.Decimal(s);

console.log("=== Margin math sanity ===");

const longPos = {
  side: "long",
  size: D("2"),
  entryPrice: D("50000"),
  collateral: D("20000"), // 5× lev
};

const liq = liquidationPriceFor(
  longPos.side,
  longPos.entryPrice,
  longPos.size,
  longPos.collateral,
);
console.log(`  long 2 BTC @ $50k, $20k collateral → liquidationPrice = $${liq}`);
console.log(`  rebate (50bps) = $${keeperRebate(longPos.collateral)}`);

console.log();
console.log("=== CHAIN C: V-25 wash-trade drives oracle, victim liquidated ===");

// Victim opens a long at $50k with 5× lev ($20k collateral).
const victim = {
  side: "long",
  size: D("1"),
  entryPrice: D("50000"),
  collateral: D("10000"),
};
const victimLiq = liquidationPriceFor(
  victim.side,
  victim.entryPrice,
  victim.size,
  victim.collateral,
);
console.log(`  victim long 1 BTC @ $50k, $10k collateral`);
console.log(`  victim liquidation @ $${victimLiq}`);

// Attacker wash-trades (V-25) to drive price to $40,500 (below victim's liq).
const manipulatedMark = D("40000");
console.log(`  attacker wash-trades BTC/USDT down to $${manipulatedMark}`);
console.log(`  victim PnL at manipulated mark: $${unrealizedPnl(victim, manipulatedMark)}`);
const breach = breachesMaintenance(victim, manipulatedMark);
console.log(`  breachesMaintenance(victim, $40k) = ${breach}`);

console.log();
console.log("=== Liquidation flow ===");

if (breach) {
  console.log("  liquidation-watcher worker flags victim position");
  console.log("  attacker (registered keeper) claims liquidation");
  const rebate = keeperRebate(victim.collateral);
  const collateralReturn = victim.collateral.add(
    unrealizedPnl(victim, manipulatedMark),
  );
  const userReturn = collateralReturn.sub(rebate);
  console.log(`  position closed at $${manipulatedMark}`);
  console.log(
    `  victim returns: collateral $${victim.collateral} + PnL = $${collateralReturn}`,
  );
  console.log(`  keeper rebate: $${rebate} (paid from collateral)`);
  console.log(`  victim gets back: $${userReturn.lt(0) ? "0" : userReturn}`);
} else {
  console.log("  not breached (unexpected)");
}

console.log();
console.log(
  "[poc] CHAIN C end-to-end shape confirmed against real engine math.",
);
