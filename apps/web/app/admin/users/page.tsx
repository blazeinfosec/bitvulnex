"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Container } from "@/components/ui/container";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
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
    <Container className="py-12 max-w-5xl space-y-4">
      <h1 className="text-3xl font-semibold tracking-tight text-navy-900 mb-2">
        Users
      </h1>
      <Card>
        <CardHeader>
          <CardTitle>Search</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="email or display name"
              className="border border-navy-200 rounded px-2 py-1 text-sm flex-1"
            />
            <label className="text-xs flex items-center gap-1">
              <input
                type="checkbox"
                checked={perf}
                onChange={(e) => setPerf(e.target.checked)}
              />
              perf mode
            </label>
            <Button size="sm" onClick={search}>
              Search
            </Button>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>{rows?.length ?? 0} results</CardTitle>
        </CardHeader>
        <CardContent>
          {!rows ? (
            <p className="text-sm text-navy-700">Loading…</p>
          ) : rows.length === 0 ? (
            <p className="text-sm text-navy-700">No matches.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-left text-navy-500 text-xs uppercase">
                <tr>
                  <th className="py-1">Email</th>
                  <th>Display name</th>
                  <th>Role</th>
                  <th>Tier</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((u) => (
                  <tr
                    key={u.id}
                    className="border-t border-navy-100 hover:bg-navy-50"
                  >
                    <td className="py-1">{u.email}</td>
                    <td
                      dangerouslySetInnerHTML={{ __html: nameCell(u) }}
                    />
                    <td>{u.role}</td>
                    <td>{u.kycTier}</td>
                    <td className="text-right">
                      <Link
                        href={`/admin/users/${u.id}`}
                        className="text-sm text-navy-700 underline"
                      >
                        Open →
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </Container>
  );
}
