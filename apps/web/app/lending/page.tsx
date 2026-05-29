import { redirect } from "next/navigation";

export const dynamic = "force-static";

// /lending is now /earn?tab=lending — slice 3 of the Phase-10 revamp
// unified lending + staking into a single Earn dashboard.
export default function LendingRedirect() {
  redirect("/earn?tab=lending");
}
