// Slug helpers for the /trade/[pair] surface.
//
// URL slugs use a hyphen (`BTC-USDT`) for readability and to avoid the
// double-encoding edge case where Next.js receives `%2F` and re-encodes
// it on dynamic routes. The REST API expects `BASE/QUOTE`, and WS
// channel names use the slash form too. All conversions live here so
// callers can't reinvent them inconsistently.

export interface PairInfo {
  /** `BTC` */
  base: string;
  /** `USDT` */
  quote: string;
  /** `BTC/USDT` — for REST + WS channels */
  pair: string;
  /** `BTC-USDT` — for URLs */
  slug: string;
}

const SLUG_RE = /^([A-Z]+)-([A-Z]+)$/;
const PAIR_RE = /^([A-Z]+)\/([A-Z]+)$/;

/**
 * Parse a URL slug like `BTC-USDT` into structured pair info. Returns
 * null if the slug doesn't match the expected `BASE-QUOTE` shape. The
 * caller is expected to lift any URL-decoding earlier in the pipeline;
 * this function does not decodeURIComponent.
 */
export function pairFromSlug(slug: string): PairInfo | null {
  const m = SLUG_RE.exec(slug);
  if (!m) return null;
  const base = m[1] as string;
  const quote = m[2] as string;
  return { base, quote, pair: `${base}/${quote}`, slug: `${base}-${quote}` };
}

/**
 * Parse a `BASE/QUOTE` pair into structured pair info. Returns null if
 * the shape doesn't match.
 */
export function pairFromString(pair: string): PairInfo | null {
  const m = PAIR_RE.exec(pair);
  if (!m) return null;
  const base = m[1] as string;
  const quote = m[2] as string;
  return { base, quote, pair: `${base}/${quote}`, slug: `${base}-${quote}` };
}

/** `BTC/USDT` -> `BTC-USDT`. Throws if shape doesn't match. */
export function pairToSlug(pair: string): string {
  return pair.replace("/", "-");
}

/**
 * Order book aggregation presets per pair. The trading UI exposes
 * exactly three buckets; defaults per pair come from the Decisions
 * ledger (BTC pairs: 0.1/1/10, ETH pairs: 0.01/0.1/1, thin alt pairs:
 * 0.0001/0.001/0.01).
 */
export function aggregationPresets(pair: PairInfo): number[] {
  if (pair.base === "BTC") return [0.1, 1, 10];
  if (pair.base === "ETH") return [0.01, 0.1, 1];
  return [0.0001, 0.001, 0.01];
}

/**
 * Smart-precision dp count for the quote currency. Stablecoins to 2,
 * BTC to 8, anything else 4.
 */
export function quoteDp(quote: string): number {
  if (quote === "USDT" || quote === "USDC") return 2;
  if (quote === "BTC") return 8;
  return 4;
}

/**
 * Smart-precision dp count for the base currency. BTC up to 8, ETH/LTC
 * up to 6, DOGE up to 4, stablecoins 2.
 */
export function baseDp(base: string): number {
  if (base === "BTC") return 8;
  if (base === "ETH" || base === "LTC") return 6;
  if (base === "DOGE") return 4;
  if (base === "USDC" || base === "USDT") return 2;
  return 4;
}
