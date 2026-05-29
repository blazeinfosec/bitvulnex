// Pre-trade confirmation gating logic.
//
// The trading UX shows a confirmation modal when the order is "large"
// relative to the user's available balance or, for market orders,
// large in absolute notional. The exact triggers come from the
// Phase-10 plan's Decisions ledger:
//
//   - notional > 10% of available balance
//   - leverage >= 5x  (not applicable to spot — handled in margin)
//   - market order with notional > $1000
//
// Notional for a limit/stop is `amount * price`. For a market order
// it's `amount * lastPrice`. The caller passes both so this module
// stays pure.

export type ConfirmTrigger =
  | "large-fraction-of-balance"
  | "large-market-notional";

export interface ConfirmInput {
  /** order type tab the user picked */
  type: "limit" | "market" | "stop_limit" | "oco";
  /** order side */
  side: "buy" | "sell";
  /** amount of BASE asset the user is buying/selling */
  amount: number;
  /** explicit price (limit/stop) or null for market */
  price: number | null;
  /** most recent trade price; used as the price ref for market orders */
  lastPrice: number | null;
  /**
   * Available balance in the asset that will be debited:
   *   buy  → quote (e.g. USDT)
   *   sell → base  (e.g. BTC)
   * Pass a number; pass 0 when there's nothing available.
   */
  available: number;
  /**
   * Quote-asset rough USD value of 1 unit. For USDT/USDC pass 1.
   * For BTC/USDT pass the BTC last price ÷ ... actually we only need
   * the absolute notional in the quote currency PLUS a hint as to
   * whether the quote currency is a USD-stable.
   */
  quoteIsUsdStable: boolean;
  /**
   * Conversion from quote-currency notional to approximate USD. Used
   * to evaluate the $1000 threshold for non-USD-stable quote pairs.
   * For example, on ETH/BTC, pass the BTC/USDT last price here so the
   * heuristic still works. Pass null if not derivable; the threshold
   * test is then skipped.
   */
  quoteToUsdRate: number | null;
}

/**
 * Returns the list of triggers that fired, or an empty array when the
 * trade is small enough to skip the confirm modal. Pure function —
 * caller decides what to do with the result.
 */
export function shouldConfirm(input: ConfirmInput): ConfirmTrigger[] {
  const triggers: ConfirmTrigger[] = [];

  const effPrice =
    input.type === "market" ? input.lastPrice : input.price ?? input.lastPrice;
  if (!effPrice || !Number.isFinite(effPrice) || effPrice <= 0) return triggers;
  if (!Number.isFinite(input.amount) || input.amount <= 0) return triggers;

  const notionalQuote = input.amount * effPrice;

  // Trigger 1 — notional > 10% of available.
  // For a sell, the debit is in the base currency, so we compare base
  // amount against base available. For a buy, the debit is in the
  // quote currency, so we compare quote notional against quote
  // available. The caller is expected to pass `available` in the
  // correct currency per side.
  const debitAmount = input.side === "buy" ? notionalQuote : input.amount;
  if (input.available > 0 && debitAmount > input.available * 0.1) {
    triggers.push("large-fraction-of-balance");
  }

  // Trigger 2 — market order > $1000.
  if (input.type === "market") {
    let notionalUsd: number | null = null;
    if (input.quoteIsUsdStable) notionalUsd = notionalQuote;
    else if (input.quoteToUsdRate && input.quoteToUsdRate > 0) {
      notionalUsd = notionalQuote * input.quoteToUsdRate;
    }
    if (notionalUsd !== null && notionalUsd > 1000) {
      triggers.push("large-market-notional");
    }
  }

  return triggers;
}
