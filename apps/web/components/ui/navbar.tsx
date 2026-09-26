"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Container } from "./container";
import { Wordmark } from "@/components/exchange/Wordmark";
import { MobileNav } from "@/components/exchange/MobileNav";
import {
  AUTH_EVENT,
  clearTokens,
  getAccessToken,
  getRefreshToken,
  getTokenClaims,
} from "@/lib/token-storage";

const linkClass =
  "px-3 py-2 text-sm font-medium text-text-dim hover:text-text transition-colors rounded-md no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent";

type DropItem = { href: string; label: string };

function NavDropdown({
  label,
  items,
  footer,
}: {
  label: string;
  items: DropItem[];
  footer?: (close: () => void) => React.ReactNode;
}) {
  const ref = useRef<HTMLDetailsElement | null>(null);
  const pathname = usePathname();
  const close = useCallback(() => {
    if (ref.current) ref.current.open = false;
  }, []);

  // Close the menu whenever the route changes.
  useEffect(() => {
    close();
  }, [pathname, close]);

  // Close when clicking outside the menu.
  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    }
    document.addEventListener("click", onDocClick);
    return () => document.removeEventListener("click", onDocClick);
  }, [close]);

  return (
    <details ref={ref} className="relative group">
      <summary
        className={
          linkClass +
          " inline-flex items-center gap-1 cursor-pointer list-none [&::-webkit-details-marker]:hidden"
        }
      >
        <span>{label}</span>
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
            onClick={close}
            className="block px-3 py-2 text-sm text-text-dim hover:text-text hover:bg-bg-hover transition-colors no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            {it.label}
          </Link>
        ))}
        {footer ? footer(close) : null}
      </div>
    </details>
  );
}

const STAFF_ROLES = new Set(["admin", "support", "compliance", "treasury"]);

export function NavBar() {
  const router = useRouter();
  const [isAuthed, setIsAuthed] = useState(false);
  const [isStaff, setIsStaff] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    const sync = () => {
      setIsAuthed(Boolean(getAccessToken()));
      const role = getTokenClaims()?.role;
      setIsStaff(Boolean(role && STAFF_ROLES.has(role)));
    };
    sync();
    window.addEventListener("storage", sync);
    window.addEventListener(AUTH_EVENT, sync);
    return () => {
      window.removeEventListener("storage", sync);
      window.removeEventListener(AUTH_EVENT, sync);
    };
  }, []);

  const signOut = useCallback(async () => {
    const refresh = getRefreshToken();
    if (refresh) {
      await fetch("/api/v2/auth/logout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ refresh }),
      }).catch(() => undefined);
    }
    clearTokens();
    router.replace("/");
  }, [router]);

  return (
    <header className="border-b border-border bg-bg-elevated relative z-20">
      <Container className="flex items-center justify-between h-16 gap-3">
        <Link
          href="/"
          className="no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded-md"
          aria-label="Bitvulnex home"
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
              items={[
                { href: "/wallet/deposit", label: "Deposit" },
                { href: "/wallet/withdraw", label: "Withdraw" },
                { href: "/wallet/transfer", label: "Transfer" },
              ]}
            />
          ) : null}
          <NavDropdown
            label="More"
            items={[
              { href: "/otc", label: "OTC desk" },
              { href: "/p2p", label: "P2P" },
              { href: "/account/api-keys", label: "API keys" },
              { href: "/referrals", label: "Referrals" },
              { href: "/subaccounts", label: "Sub-accounts" },
              { href: "/support", label: "Support" },
            ]}
          />
          {isAuthed && isStaff ? (
            <Link href="/admin" className={linkClass}>
              Admin
            </Link>
          ) : null}
          {isAuthed ? (
            <NavDropdown
              label="Account"
              items={[
                { href: "/account", label: "Overview" },
                { href: "/account/profile", label: "Profile" },
                { href: "/account/security", label: "Security" },
                { href: "/account/kyc", label: "KYC" },
                { href: "/account/api-keys", label: "API keys" },
                { href: "/account/orders", label: "Orders" },
              ]}
              footer={(close) => (
                <button
                  type="button"
                  onClick={() => {
                    close();
                    void signOut();
                  }}
                  className="block w-full text-left px-3 py-2 text-sm text-text-dim hover:text-text hover:bg-bg-hover transition-colors border-t border-border-subtle mt-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                >
                  Sign out
                </button>
              )}
            />
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
          isStaff={isStaff}
          onSignOut={signOut}
        />
      </div>
    </header>
  );
}
