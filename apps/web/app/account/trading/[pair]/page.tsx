import { redirect } from "next/navigation";

// The trading view moved to /trade/[pair] in slice 4. Preserve any
// inbound link or bookmark by 307-redirecting to the new URL.
export default async function LegacyTradingRedirect({
  params,
}: {
  params: Promise<{ pair: string }>;
}) {
  const { pair } = await params;
  redirect(`/trade/${pair}`);
}
