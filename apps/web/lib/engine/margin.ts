// Re-export margin math from @bvbe/shared so the web matching
// engine and the worker liquidation watcher consume the same
// implementation. (Phase-5 fix-up Q-5.3.)

export {
  MAINTENANCE_MARGIN_BPS,
  KEEPER_REBATE_BPS,
  liquidationPriceFor,
  unrealizedPnl,
  breachesMaintenance,
  keeperRebate,
  type PositionShape,
} from "@bvbe/shared";
