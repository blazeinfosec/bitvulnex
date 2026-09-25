"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { authedFetch, loadFailure } from "@/lib/token-storage";
import { StatCard } from "@/components/exchange";

type QueueStats = {
  kycPending: number;
  ticketsOpen: number;
  complianceOpen: number;
  treasuryDrafts: number;
};

export default function AdminLanding() {
  const router = useRouter();
  const [ok, setOk] = useState(false);
  const [stats, setStats] = useState<QueueStats | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const res = await authedFetch("/api/v2/admin/kyc/queue").catch(() => null);
      const fail = await loadFailure(res);
      if (fail) {
        if (fail.redirect) router.replace("/login");
        else setLoadError(fail.message);
        return;
      }
      setOk(true);
      // Best-effort stats: KYC queue count, ticket count, etc.
      try {
        const kyc = (await res!.clone().json()) as { queue?: unknown[] };
        const [t, c, d] = await Promise.all([
          authedFetch("/api/v2/admin/tickets"),
          authedFetch("/api/v2/admin/compliance/cases"),
          authedFetch("/api/v2/admin/treasury/drafts"),
        ]);
        type WithStatus = { status?: string };
        const tickets = t.ok
          ? ((await t.json()) as { tickets?: WithStatus[] })
          : { tickets: [] };
        const cases = c.ok
          ? ((await c.json()) as { cases?: WithStatus[] })
          : { cases: [] };
        const drafts = d.ok
          ? ((await d.json()) as { drafts?: WithStatus[] })
          : { drafts: [] };
        const count = (rows: WithStatus[] | undefined, open: string[]) =>
          (rows ?? []).filter((r) => !r.status || open.includes(r.status))
            .length;
        setStats({
          kycPending: kyc.queue?.length ?? 0,
          ticketsOpen: count(tickets.tickets, [
            "open",
            "awaiting_user",
            "awaiting_agent",
          ]),
          complianceOpen: count(cases.cases, ["open", "in_review", "escalated"]),
          treasuryDrafts: count(drafts.drafts, ["drafted", "partial"]),
        });
      } catch {
        // ignore — stats are best-effort
      }
    })();
  }, [router]);

  if (loadError) {
    return <p className="text-sell text-sm">{loadError}</p>;
  }

  if (!ok) {
    return <p className="text-text-dim">Loading…</p>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-text">
          Admin dashboard
        </h1>
        <p className="text-sm text-text-dim mt-1">
          Operational queues and platform tools.
        </p>
      </div>

      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="KYC pending"
          value={stats?.kycPending ?? "—"}
          hint="Awaiting reviewer"
        />
        <StatCard
          label="Open tickets"
          value={stats?.ticketsOpen ?? "—"}
          hint="Support inbox"
        />
        <StatCard
          label="Open compliance cases"
          value={stats?.complianceOpen ?? "—"}
          hint="Open investigations"
        />
        <StatCard
          label="Treasury drafts"
          value={stats?.treasuryDrafts ?? "—"}
          hint="Awaiting signatures"
        />
      </div>

      <div className="grid sm:grid-cols-2 gap-4">
        <AdminTile
          href="/admin/users"
          title="Users"
          description="Search, freeze, adjust balances, manage roles."
        />
        <AdminTile
          href="/admin/tickets"
          title="Support inbox"
          description="Reply to user tickets, change status."
        />
        <AdminTile
          href="/admin/kyc"
          title="KYC review queue"
          description="Approve or reject identity submissions."
        />
        <AdminTile
          href="/admin/compliance"
          title="Compliance"
          description="Open cases, sanctions imports, exports."
        />
        <AdminTile
          href="/admin/treasury"
          title="Treasury"
          description="Multi-sig coordinator: draft, sign, broadcast."
        />
      </div>
    </div>
  );
}

function AdminTile({
  href,
  title,
  description,
}: {
  href: string;
  title: string;
  description: string;
}) {
  return (
    <Link
      href={href}
      className="block rounded-lg border border-border bg-bg-elevated p-5 hover:bg-bg-hover hover:border-accent/40 transition-colors no-underline"
    >
      <div className="flex items-start justify-between">
        <div>
          <h3 className="text-sm font-semibold text-text">{title}</h3>
          <p className="text-xs text-text-dim mt-1">{description}</p>
        </div>
        <span className="text-accent text-sm">→</span>
      </div>
    </Link>
  );
}
