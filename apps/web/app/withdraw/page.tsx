import { redirect } from "next/navigation";

export default function WithdrawRedirect() {
  redirect("/wallet/withdraw");
}
