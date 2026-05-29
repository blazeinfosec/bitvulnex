import { redirect } from "next/navigation";

export const dynamic = "force-static";

// /staking is now /earn?tab=staking — slice 3 of the Phase-10 revamp
// unified lending + staking into a single Earn dashboard.
export default function StakingRedirect() {
  redirect("/earn?tab=staking");
}
