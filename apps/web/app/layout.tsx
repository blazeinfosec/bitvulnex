import "../styles/globals.css";
import type { Metadata } from "next";
import { DoNotDeployBanner } from "@/components/banner/do-not-deploy";
import { NavBar } from "@/components/ui/navbar";
import { Footer } from "@/components/ui/footer";
import { TickerHost } from "@/components/exchange/TickerHost";

export const metadata: Metadata = {
  title: "Bitvulnex — Vulnerable Bitcoin Exchange",
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
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:px-3 focus:py-2 focus:rounded-md focus:bg-accent focus:text-accent-fg focus:text-sm focus:font-medium focus:no-underline"
        >
          Skip to main content
        </a>
        <DoNotDeployBanner variant="top" />
        <NavBar />
        <TickerHost />
        <main id="main" className="flex-1">
          {children}
        </main>
        <Footer />
        <DoNotDeployBanner variant="footer" />
      </body>
    </html>
  );
}
