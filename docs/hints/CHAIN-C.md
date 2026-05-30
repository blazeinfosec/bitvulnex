---
target: CHAIN-C
category: Business logic — oracle manipulation → liquidation cascade
steps:
  1:
    tier-1-basic: "Self-matching. The engine doesn't refuse to cross orders that share an owner."
    tier-2-verbose: "Place a resting limit at a chosen price, then immediately fire a matching order from the same account. A real trade prints and the public last-price feed updates."
  2:
    tier-1-basic: "Oracle consumer. Some risk subsystem reads that public price."
    tier-2-verbose: "The margin liquidation watcher consumes the public last-price as its mark — no separate oracle, no median. Repeat the self-trade move to walk the mark in your direction."
  3:
    tier-1-basic: "Settlement. Liquidation rebates pay the keeper that claims them."
    tier-2-verbose: "Register as a keeper, watch the liquidation queue fire against the contaminated mark, and claim the rebate. The victim's position closes against synthetic price."
---
