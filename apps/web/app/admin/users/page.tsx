"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { authedFetch } from "@/lib/token-storage";

type UserRow = {
  id: string;
  email: string;
  displayName: string | null;
  role: string;
  kycTier: number;
};

// Wrap the display label in a <strong> for KYC-approved users so the
// reviewing admin's eye lands on the verified name quickly.
function nameCell(u: UserRow): string {
  const label = u.displayName ?? "";
  return u.kycTier >= 1 ? `<strong>${label}</strong>` : label;
}

const inputClass =
  "h-10 px-3 rounded-md bg-bg border border-border text-text placeholder:text-text-mute focus:outline-none focus:ring-2 focus:ring-accent focus:border-accent transition-colors";

const primaryBtn =
  "inline-flex items-center justify-center h-10 px-4 rounded-md bg-accent text-accent-fg hover:bg-accent-hover transition-colors font-semibold text-sm";

export default function AdminUsersPage() {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [perf, setPerf] = useState(false);
  const [rows, setRows] = useState<UserRow[] | null>(null);

  async function search() {
    const params = new URLSearchParams({ q });
    if (perf) params.set("perf", "1");
    const res = await authedFetch(
      `/api/v2/admin/users/search?${params.toString()}`,
    );
    if (res.status === 401 || res.status === 403) {
      router.replace("/login");
      return;
    }
    const body = (await res.json()) as { users: UserRow[] };
    setRows(body.users);
  }

  useEffect(() => {
    search();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-text">
          Users
        </h1>
        <p className="text-sm text-text-dim mt-1">
          Search by email or display name. Open a row to manage balances and
          freeze status.
        </p>
      </div>

      <section className="rounded-lg border border-border bg-bg-elevated p-5">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[200px]">
            <label className="block text-xs uppercase tracking-wider text-text-mute mb-1.5 font-medium">
              Search
            </label>
            <input
              type="text"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="email or display name"
              className={inputClass + " w-full"}
              onKeyDown={(e) => {
                if (e.key === "Enter") search();
              }}
            />
          </div>
          <label className="text-sm flex items-center gap-2 h-10 self-end text-text-dim">
            <input
              type="checkbox"
              checked={perf}
              onChange={(e) => setPerf(e.target.checked)}
              className="accent-accent"
            />
            <span className="font-mono uppercase text-xs tracking-wider">
              perf mode
            </span>
          </label>
          <button type="button" className={primaryBtn} onClick={search}>
            Search
          </button>
        </div>
      </section>

      <section>
        <div className="text-xs uppercase tracking-wider text-text-mute font-medium mb-2">
          {rows?.length ?? 0} results
        </div>
        <div className="rounded-lg border border-border bg-bg-elevated overflow-hidden">
          {!rows ? (
            <p className="px-4 py-10 text-center text-text-mute text-sm">
              Loading…
            </p>
          ) : rows.length === 0 ? (
            <p className="px-4 py-10 text-center text-text-mute text-sm">
              No matches.
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="px-4 py-3 text-left text-xs uppercase tracking-wider text-text-mute font-medium">
                    Email
                  </th>
                  <th className="px-4 py-3 text-left text-xs uppercase tracking-wider text-text-mute font-medium">
                    Display name
                  </th>
                  <th className="px-4 py-3 text-left text-xs uppercase tracking-wider text-text-mute font-medium">
                    Role
                  </th>
                  <th className="px-4 py-3 text-right text-xs uppercase tracking-wider text-text-mute font-medium">
                    Tier
                  </th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {rows.map((u) => (
                  <tr
                    key={u.id}
                    className="border-b border-border-subtle last:border-0 hover:bg-bg-hover transition-colors"
                  >
                    <td className="px-4 py-3 text-text font-mono text-xs">
                      {u.email}
                    </td>
                    <td
                      className="px-4 py-3 text-text"
                      dangerouslySetInnerHTML={{ __html: nameCell(u) }}
                    />
                    <td className="px-4 py-3">
                      <span className="inline-block px-2 py-0.5 text-[10px] uppercase tracking-wider rounded bg-bg border border-border text-text-dim font-medium">
                        {u.role}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right font-mono tabular-nums text-text">
                      {u.kycTier}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Link
                        href={`/admin/users/${u.id}`}
                        className="text-accent text-sm hover:underline"
                      >
                        Open →
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>
    </div>
  );
}
