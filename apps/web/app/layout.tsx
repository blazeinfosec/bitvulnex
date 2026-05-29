import "../styles/globals.css";
import type { Metadata } from "next";
import { DoNotDeployBanner } from "@/components/banner/do-not-deploy";
import { NavBar } from "@/components/ui/navbar";
import { Footer } from "@/components/ui/footer";
import { TickerHost } from "@/components/exchange/TickerHost";

export const metadata: Metadata = {
  title: "BVBE — Blaze Vulnerable Bitcoin Exchange",
  description:
    "Authorized security education lab. Deliberately vulnerable. Do not deploy.",
  robots: { index: false, follow: false },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen flex flex-col font-sans bg-bg text-text">
        <DoNotDeployBanner variant="top" />
        <NavBar />
        <TickerHost />
        <main className="flex-1">{children}</main>
        <Footer />
        <DoNotDeployBanner variant="footer" />
      </body>
    </html>
  );
}
