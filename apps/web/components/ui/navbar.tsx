"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Container } from "./container";
import { Wordmark } from "@/components/exchange/Wordmark";
import { MobileNav } from "@/components/exchange/MobileNav";
import { authedFetch, getAccessToken } from "@/lib/token-storage";

const linkClass =
  "px-3 py-2 text-sm font-medium text-text-dim hover:text-text transition-colors rounded-md no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent";

type DropItem = { href: string; label: string };

function NavDropdown({
  label,
  href,
  items,
}: {
  label: string;
  href: string;
  items: DropItem[];
}) {
  return (
    <details className="relative group">
      <summary
        className={
          linkClass +
          " inline-flex items-center gap-1 cursor-pointer list-none [&::-webkit-details-marker]:hidden"
        }
      >
        <Link href={href} className="no-underline text-inherit">
          {label}
        </Link>
        <svg
          width="10"
          height="10"
          viewBox="0 0 20 20"
          fill="currentColor"
          className="text-text-mute"
          aria-hidden="true"
        >
          <path d="M5.5 7.5L10 12l4.5-4.5z" />
        </svg>
      </summary>
      <div className="absolute left-0 top-full mt-1 min-w-[180px] rounded-md border border-border bg-bg-elevated shadow-elevated z-30 py-1">
        {items.map((it) => (
          <Link
            key={it.href}
            href={it.href}
            className="block px-3 py-2 text-sm text-text-dim hover:text-text hover:bg-bg-hover transition-colors no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            {it.label}
          </Link>
        ))}
      </div>
    </details>
  );
}

export function NavBar() {
  const [isAuthed, setIsAuthed] = useState(false);
  const [role, setRole] = useState<string | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    setIsAuthed(Boolean(getAccessToken()));
    const onStorage = () => setIsAuthed(Boolean(getAccessToken()));
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  useEffect(() => {
    if (!isAuthed) {
      setRole(null);
      return;
    }
    (async () => {
      try {
        const res = await authedFetch("/api/v2/me");
        if (res.ok) {
          const body = (await res.json()) as { role?: string };
          setRole(body.role ?? null);
        }
      } catch {
        // ignore
      }
    })();
  }, [isAuthed]);

  return (
    <header className="border-b border-border bg-bg-elevated relative z-20">
      <Container className="flex items-center justify-between h-16 gap-3">
        <Link
          href="/"
          className="no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded-md"
          aria-label="BVBE home"
        >
          <Wordmark />
        </Link>
        {/* Desktop nav */}
        <nav
          className="hidden md:flex items-center gap-1"
          aria-label="Primary"
        >
          <Link href="/markets" className={linkClass}>
            Markets
          </Link>
          {isAuthed ? (
            <Link href="/trade/BTC-USDT" className={linkClass}>
              Trade
            </Link>
          ) : null}
          <Link href="/earn" className={linkClass}>
            Earn
          </Link>
          {isAuthed ? (
            <Link href="/portfolio" className={linkClass}>
              Portfolio
            </Link>
          ) : null}
          {isAuthed ? (
            <NavDropdown
              label="Wallet"
              href="/wallet/deposit"
              items={[
                { href: "/wallet/deposit", label: "Deposit" },
                { href: "/wallet/withdraw", label: "Withdraw" },
                { href: "/wallet/transfer", label: "Transfer" },
              ]}
            />
          ) : null}
          <NavDropdown
            label="More"
            href="/otc"
            items={[
              { href: "/otc", label: "OTC desk" },
              { href: "/p2p", label: "P2P" },
              { href: "/account/api-keys", label: "API keys" },
              { href: "/referrals", label: "Referrals" },
              { href: "/subaccounts", label: "Sub-accounts" },
            ]}
          />
          {isAuthed ? (
            <NavDropdown
              label="Account"
              href="/account/profile"
              items={[
                { href: "/account/profile", label: "Profile" },
                { href: "/account/security", label: "Security" },
                { href: "/account/kyc", label: "KYC" },
                { href: "/account/api-keys", label: "API keys" },
              ]}
            />
          ) : null}
          {isAuthed && role === "admin" ? (
            <Link href="/admin" className={linkClass}>
              Admin
            </Link>
          ) : null}
          {!isAuthed ? (
            <>
              <Link
                href="/login"
                className="ml-2 inline-flex items-center justify-center h-9 px-4 text-sm font-medium text-text border border-border rounded-md hover:bg-bg-hover transition-colors no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                Sign in
              </Link>
              <Link
                href="/signup"
                className="inline-flex items-center justify-center h-9 px-4 text-sm font-semibold rounded-md bg-accent text-accent-fg hover:bg-accent-hover transition-colors no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                Create account
              </Link>
            </>
          ) : null}
        </nav>

        {/* Mobile hamburger */}
        <button
          type="button"
          className="md:hidden inline-flex items-center justify-center h-10 w-10 rounded-md text-text-dim hover:text-text hover:bg-bg-hover transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          aria-label="Open navigation menu"
          aria-expanded={mobileOpen}
          aria-controls="mobile-nav"
          onClick={() => setMobileOpen(true)}
        >
          <svg
            width="22"
            height="22"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <line x1="3" y1="6" x2="21" y2="6" />
            <line x1="3" y1="12" x2="21" y2="12" />
            <line x1="3" y1="18" x2="21" y2="18" />
          </svg>
        </button>
      </Container>
      <div id="mobile-nav">
        <MobileNav
          open={mobileOpen}
          onClose={() => setMobileOpen(false)}
          isAuthed={isAuthed}
          isAdmin={role === "admin"}
        />
      </div>
    </header>
  );
}
