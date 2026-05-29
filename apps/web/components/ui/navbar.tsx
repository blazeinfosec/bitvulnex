"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Container } from "./container";
import { Wordmark } from "@/components/exchange/Wordmark";
import { getAccessToken } from "@/lib/token-storage";

const linkClass =
  "px-3 py-2 text-sm font-medium text-text-dim hover:text-text transition-colors rounded-md";

export function NavBar() {
  const [isAuthed, setIsAuthed] = useState(false);

  useEffect(() => {
    setIsAuthed(Boolean(getAccessToken()));
    const onStorage = () => setIsAuthed(Boolean(getAccessToken()));
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  return (
    <header className="border-b border-border bg-bg-elevated">
      <Container className="flex items-center justify-between h-16">
        <Link href="/" className="no-underline">
          <Wordmark />
        </Link>
        <nav className="flex items-center gap-1">
          {isAuthed ? (
            <Link href="/account/trading/BTC-USDT" className={linkClass}>
              Trade
            </Link>
          ) : null}
          <Link href="/lending" className={linkClass}>
            Lending
          </Link>
          <Link href="/staking" className={linkClass}>
            Staking
          </Link>
          <Link href="/otc" className={linkClass}>
            OTC
          </Link>
          <Link href="/p2p" className={linkClass}>
            P2P
          </Link>
          <Link href="/withdraw" className={linkClass}>
            Withdraw
          </Link>
          {isAuthed ? (
            <Link href="/support" className={linkClass}>
              Support
            </Link>
          ) : null}
          <Link href="/about/changelog" className={linkClass}>
            Changelog
          </Link>
          <Link href="/docs" className={linkClass}>
            API Docs
          </Link>
          {!isAuthed ? (
            <>
              <Link
                href="/login"
                className="ml-2 inline-flex items-center justify-center h-9 px-4 text-sm font-medium text-text border border-border rounded-md hover:bg-bg-hover transition-colors"
              >
                Sign in
              </Link>
              <Link
                href="/signup"
                className="inline-flex items-center justify-center h-9 px-4 text-sm font-semibold rounded-md bg-accent text-accent-fg hover:bg-accent-hover transition-colors"
              >
                Create account
              </Link>
            </>
          ) : null}
        </nav>
      </Container>
    </header>
  );
}
