"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";

interface MobileNavSection {
  label: string;
  items: { href: string; label: string }[];
}

interface MobileNavProps {
  open: boolean;
  onClose: () => void;
  isAuthed: boolean;
}

export function MobileNav({ open, onClose, isAuthed }: MobileNavProps) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    previouslyFocused.current = document.activeElement as HTMLElement | null;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const focusables = panelRef.current?.querySelectorAll<HTMLElement>(
      'a, button, [tabindex]:not([tabindex="-1"])',
    );
    focusables?.[0]?.focus();

    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== "Tab" || !panelRef.current) return;
      const items = panelRef.current.querySelectorAll<HTMLElement>(
        'a, button, [tabindex]:not([tabindex="-1"])',
      );
      if (items.length === 0) return;
      const first = items[0]!;
      const last = items[items.length - 1]!;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
    window.addEventListener("keydown", handleKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener("keydown", handleKey);
      previouslyFocused.current?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;

  const sections: MobileNavSection[] = [];
  const top: { href: string; label: string }[] = [
    { href: "/markets", label: "Markets" },
    { href: "/earn", label: "Earn" },
  ];
  if (isAuthed) {
    top.splice(1, 0, { href: "/trade/BTC-USDT", label: "Trade" });
    top.push({ href: "/portfolio", label: "Portfolio" });
  }
  sections.push({ label: "Trade", items: top });

  if (isAuthed) {
    sections.push({
      label: "Wallet",
      items: [
        { href: "/wallet/deposit", label: "Deposit" },
        { href: "/wallet/withdraw", label: "Withdraw" },
        { href: "/wallet/transfer", label: "Transfer" },
      ],
    });
  }
  sections.push({
    label: "More",
    items: [
      { href: "/otc", label: "OTC desk" },
      { href: "/p2p", label: "P2P" },
      { href: "/account/api-keys", label: "API keys" },
      { href: "/referrals", label: "Referrals" },
      { href: "/subaccounts", label: "Sub-accounts" },
    ],
  });
  if (isAuthed) {
    sections.push({
      label: "Account",
      items: [
        { href: "/account/profile", label: "Profile" },
        { href: "/account/security", label: "Security" },
        { href: "/account/kyc", label: "KYC" },
        { href: "/account/api-keys", label: "API keys" },
      ],
    });
  }
  return (
    <div
      className="fixed inset-0 z-40 md:hidden"
      role="dialog"
      aria-modal="true"
      aria-label="Site navigation"
    >
      <button
        type="button"
        aria-label="Close navigation menu"
        tabIndex={-1}
        className="absolute inset-0 bg-black/60 backdrop-blur-sm cursor-default"
        onClick={onClose}
      />
      <div
        ref={panelRef}
        className="absolute right-0 top-0 h-full w-80 max-w-[85vw] bg-bg-elevated border-l border-border shadow-elevated overflow-y-auto"
      >
        <div className="flex items-center justify-between p-4 border-b border-border">
          <span className="text-sm font-semibold text-text">Menu</span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close navigation menu"
            className="p-1 text-text-mute hover:text-text rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
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
              <path d="M18 6 6 18" />
              <path d="m6 6 12 12" />
            </svg>
          </button>
        </div>
        <nav className="p-2">
          {sections.map((sec) => (
            <div key={sec.label} className="mb-2">
              <div className="px-3 pt-3 pb-1 text-[11px] uppercase tracking-wider text-text-mute font-semibold">
                {sec.label}
              </div>
              {sec.items.map((it) => (
                <Link
                  key={it.href}
                  href={it.href}
                  onClick={onClose}
                  className="block px-3 py-2 text-sm text-text-dim hover:text-text hover:bg-bg-hover rounded transition-colors no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                >
                  {it.label}
                </Link>
              ))}
            </div>
          ))}
          {!isAuthed ? (
            <div className="px-3 pb-3 pt-2 border-t border-border-subtle mt-2 space-y-2">
              <Link
                href="/login"
                onClick={onClose}
                className="block h-10 leading-10 text-center text-sm font-medium text-text border border-border rounded-md hover:bg-bg-hover transition-colors no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                Sign in
              </Link>
              <Link
                href="/signup"
                onClick={onClose}
                className="block h-10 leading-10 text-center text-sm font-semibold rounded-md bg-accent text-accent-fg hover:bg-accent-hover transition-colors no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                Create account
              </Link>
            </div>
          ) : null}
        </nav>
      </div>
    </div>
  );
}
