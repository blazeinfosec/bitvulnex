// Margin math. Pure functions, no I/O. Shared between the web
// matching engine and the worker liquidation watcher to keep the
// formulas in one place. (Phase-5 L7 Q-5.3 fix: previously inlined
// in two places.)

import { Prisma } from "@bvbe/db";

export const MAINTENANCE_MARGIN_BPS = 50; // 0.5%
export const KEEPER_REBATE_BPS = 50; // 0.5% of collateral

export type PositionShape = {
  side: "long" | "short";
  size: Prisma.Decimal;
  entryPrice: Prisma.Decimal;
  leverage: number;
  collateral: Prisma.Decimal;
};

export function liquidationPriceFor(
  side: "long" | "short",
  entryPrice: Prisma.Decimal,
  size: Prisma.Decimal,
  collateral: Prisma.Decimal,
): Prisma.Decimal {
  if (size.lte(0)) throw new Error("size must be > 0");
  const notional = size.mul(entryPrice);
  const maintenanceBuffer = notional.mul(MAINTENANCE_MARGIN_BPS).div(10_000);
  const loss = collateral.sub(maintenanceBuffer);
  if (loss.lte(0)) return entryPrice;
  const priceDelta = loss.div(size);
  return side === "long"
    ? entryPrice.sub(priceDelta)
    : entryPrice.add(priceDelta);
}

export function unrealizedPnl(
  pos: Pick<PositionShape, "side" | "size" | "entryPrice">,
  markPrice: Prisma.Decimal,
): Prisma.Decimal {
  const diff = markPrice.sub(pos.entryPrice);
  return pos.side === "long" ? pos.size.mul(diff) : pos.size.mul(diff).neg();
}

export function breachesMaintenance(
  pos: Pick<PositionShape, "side" | "size" | "entryPrice" | "collateral">,
  markPrice: Prisma.Decimal,
): boolean {
  const liqPrice = liquidationPriceFor(
    pos.side,
    pos.entryPrice,
    pos.size,
    pos.collateral,
  );
  return pos.side === "long"
    ? markPrice.lte(liqPrice)
    : markPrice.gte(liqPrice);
}

export function keeperRebate(collateral: Prisma.Decimal): Prisma.Decimal {
  return collateral.mul(KEEPER_REBATE_BPS).div(10_000);
}
