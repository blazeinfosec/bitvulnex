import "../styles/globals.css";
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/inter/700.css";
import type { Metadata } from "next";
import { DoNotDeployBanner } from "@/components/banner/do-not-deploy";
import { NavBar } from "@/components/ui/navbar";
import { Footer } from "@/components/ui/footer";

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
    <html lang="en">
      <body className="min-h-screen flex flex-col font-sans">
        <DoNotDeployBanner variant="top" />
        <NavBar />
        <main className="flex-1">{children}</main>
        <Footer />
        <DoNotDeployBanner variant="footer" />
      </body>
    </html>
  );
}
