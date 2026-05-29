import { redirect } from "next/navigation";

export default function AccountDepositRedirect() {
  redirect("/wallet/deposit");
}
