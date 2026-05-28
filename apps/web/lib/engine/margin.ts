// Margin math. Pure functions, no I/O. Liquidation price formula
// derived from maintenance-margin requirement.

import { Prisma } from "@bvbe/db";

const D = (v: Prisma.Decimal | string | number) => new Prisma.Decimal(v);

export const MAINTENANCE_MARGIN_BPS = 50; // 0.5%
export const KEEPER_REBATE_BPS = 50; // 0.5% of collateral

export type PositionShape = {
  side: "long" | "short";
  size: Prisma.Decimal;
  entryPrice: Prisma.Decimal;
  leverage: number;
  collateral: Prisma.Decimal;
};

/**
 * Liquidation price assuming maintenance margin = MAINTENANCE_MARGIN_BPS.
 *
 * For a long with collateral C and entry P, size S, leverage L:
 *   notional = S * P
 *   loss at liquidation = collateral - (notional * MM_bps / 10000)
 *   priceDelta = loss / S
 *   liquidationPrice = P - priceDelta  (long; for short flip sign)
 */
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
  if (loss.lte(0)) {
    // Already at liquidation on entry — refuse.
    return entryPrice;
  }
  const priceDelta = loss.div(size);
  return side === "long"
    ? entryPrice.sub(priceDelta)
    : entryPrice.add(priceDelta);
}

/** Unrealized PnL at the given mark price. */
export function unrealizedPnl(
  pos: Pick<PositionShape, "side" | "size" | "entryPrice">,
  markPrice: Prisma.Decimal,
): Prisma.Decimal {
  const diff = markPrice.sub(pos.entryPrice);
  return pos.side === "long" ? pos.size.mul(diff) : pos.size.mul(diff).neg();
}

/** Whether the position would be liquidated at this mark. */
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

/** Keeper rebate amount in the collateral asset. */
export function keeperRebate(collateral: Prisma.Decimal): Prisma.Decimal {
  return collateral.mul(KEEPER_REBATE_BPS).div(10_000);
}

export const D_HELPER = D;
