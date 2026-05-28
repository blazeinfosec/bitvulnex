// Schema-layer asset registry. The set lives here (not on TradingPair)
// because lending/staking assets need not have a trading pair.
//
// Phase-5 fix-up F-1: pin the asset string on transfer/lending/staking
// endpoints so a typo'd or attacker-supplied asset can't create a
// phantom Balance row that the engine ignores.

export const KNOWN_ASSETS: ReadonlySet<string> = new Set([
  "BTC",
  "USDT",
  "USDC",
  "ETH",
  "LTC",
  "DOGE",
]);

export class AssetError extends Error {
  readonly status = 400;
}

export function requireKnownAsset(asset: string): void {
  if (!KNOWN_ASSETS.has(asset)) {
    throw new AssetError(`unknown asset: ${asset}`);
  }
}
