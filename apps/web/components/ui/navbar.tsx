"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Container } from "./container";
import { Button } from "./button";
import { getAccessToken } from "@/lib/token-storage";

export function NavBar() {
  const [isAuthed, setIsAuthed] = useState(false);

  useEffect(() => {
    setIsAuthed(Boolean(getAccessToken()));
    const onStorage = () => setIsAuthed(Boolean(getAccessToken()));
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  return (
    <header className="border-b border-navy-200 bg-white">
      <Container className="flex items-center justify-between h-16">
        <Link href="/" className="flex items-center gap-2 no-underline">
          <span className="font-semibold text-navy-900 tracking-tight">
            BVBE
          </span>
          <span className="text-xs uppercase tracking-wider text-navy-500">
            Exchange · Lab
          </span>
        </Link>
        <nav className="flex items-center gap-1">
          <Button variant="ghost" size="sm" asChild>
            <Link href="/lending">Lending</Link>
          </Button>
          <Button variant="ghost" size="sm" asChild>
            <Link href="/staking">Staking</Link>
          </Button>
          <Button variant="ghost" size="sm" asChild>
            <Link href="/otc">OTC</Link>
          </Button>
          <Button variant="ghost" size="sm" asChild>
            <Link href="/p2p">P2P</Link>
          </Button>
          <Button variant="ghost" size="sm" asChild>
            <Link href="/withdraw">Withdraw</Link>
          </Button>
          {isAuthed ? (
            <Button variant="ghost" size="sm" asChild>
              <Link href="/support">Support</Link>
            </Button>
          ) : null}
          <Button variant="ghost" size="sm" asChild>
            <Link href="/about/changelog">Changelog</Link>
          </Button>
          <Button variant="ghost" size="sm" asChild>
            <Link href="/docs">API Docs</Link>
          </Button>
          <Button variant="secondary" size="sm" asChild>
            <Link href="/login">Sign in</Link>
          </Button>
          <Button variant="primary" size="sm" asChild>
            <Link href="/signup">Create account</Link>
          </Button>
        </nav>
      </Container>
    </header>
  );
}
