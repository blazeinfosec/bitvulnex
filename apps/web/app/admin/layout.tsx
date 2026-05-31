"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const sections: { href: string; label: string; matchPrefix?: string }[] = [
  { href: "/admin", label: "Dashboard" },
  { href: "/admin/users", label: "Users", matchPrefix: "/admin/users" },
  { href: "/admin/kyc", label: "KYC review", matchPrefix: "/admin/kyc" },
  { href: "/admin/tickets", label: "Tickets", matchPrefix: "/admin/tickets" },
  {
    href: "/admin/compliance",
    label: "Compliance",
    matchPrefix: "/admin/compliance",
  },
  { href: "/admin/treasury", label: "Treasury", matchPrefix: "/admin/treasury" },
  { href: "/admin/ctf", label: "CTF", matchPrefix: "/admin/ctf" },
];

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();

  function isActive(s: (typeof sections)[number]) {
    if (s.matchPrefix) return pathname?.startsWith(s.matchPrefix);
    return pathname === s.href;
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[220px_1fr] min-h-[calc(100vh-200px)]">
      <aside className="border-r border-border bg-bg-elevated lg:sticky lg:top-0 lg:h-screen lg:overflow-y-auto">
        <div className="p-4 border-b border-border">
          <div className="text-xs uppercase tracking-wider text-text-mute font-semibold">
            Admin console
          </div>
          <div className="text-sm text-text mt-1">Bitvulnex</div>
        </div>
        <nav className="p-2 space-y-1">
          {sections.map((s) => (
            <Link
              key={s.href}
              href={s.href}
              className={cn(
                "block rounded-md px-3 py-2 text-sm transition-colors no-underline",
                isActive(s)
                  ? "bg-accent/10 text-text border border-accent/40"
                  : "text-text-dim hover:bg-bg-hover hover:text-text border border-transparent",
              )}
            >
              {s.label}
            </Link>
          ))}
        </nav>
        <div className="p-4 border-t border-border mt-4 text-xs text-text-mute">
          Authorized admins only. Actions are audit-logged.
        </div>
      </aside>
      <div className="min-w-0 p-6">{children}</div>
    </div>
  );
}
