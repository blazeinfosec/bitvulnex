import { notFound } from "next/navigation";
import { prisma } from "@bvbe/db";
import { pairFromSlug } from "@/lib/trade/pair";
import { TradingClient } from "./trading-client";

// The /trade/[pair] route is the hero trading surface. The page itself
// is a server component that:
//   1. Parses the URL slug (`BTC-USDT`) into structured pair info
//   2. Verifies the pair exists and is active (else 404)
//   3. Pre-renders a minimal shell + hands off to a client component
//      that does the WS subscriptions, dynamic chart load, and order
//      form state.

export const dynamic = "force-dynamic";

export default async function TradePage(props: {
  params: Promise<{ pair: string }>;
}) {
  const { pair: slug } = await props.params;
  const info = pairFromSlug(decodeURIComponent(slug));
  if (!info) notFound();

  const tp = await prisma.tradingPair.findFirst({
    where: { base: info.base, quote: info.quote, active: true },
  });
  if (!tp) notFound();

  return <TradingClient base={info.base} quote={info.quote} />;
}
