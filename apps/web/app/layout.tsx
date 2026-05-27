import "../styles/globals.css";
import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { DoNotDeployBanner } from "@/components/banner/do-not-deploy";
import { NavBar } from "@/components/ui/navbar";
import { Footer } from "@/components/ui/footer";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });

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
    <html lang="en" className={inter.variable}>
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
