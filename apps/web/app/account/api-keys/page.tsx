"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Container } from "@/components/ui/container";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { authedFetch } from "@/lib/token-storage";

type ApiKeyListItem = {
  id: string;
  name: string;
  scopes: string[];
  createdAt: string;
  lastUsedAt: string | null;
};

const SCOPES = ["read", "trade", "withdraw"] as const;

export default function ApiKeysPage() {
  const router = useRouter();
  const [keys, setKeys] = useState<ApiKeyListItem[]>([]);
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<string[]>(["read"]);
  const [created, setCreated] = useState<string | null>(null);

  async function load() {
    const res = await authedFetch("/api/v2/me/api-keys");
    if (res.status === 401) {
      router.replace("/login");
      return;
    }
    const body = await res.json();
    setKeys(body.keys);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    const res = await authedFetch("/api/v2/me/api-keys", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, scopes }),
    });
    const body = await res.json();
    setCreated(body.key);
    setName("");
    await load();
  }

  async function revoke(id: string) {
    await authedFetch(`/api/v2/me/api-keys/${id}`, { method: "DELETE" });
    await load();
  }

  function toggleScope(s: string) {
    setScopes((curr) =>
      curr.includes(s) ? curr.filter((x) => x !== s) : [...curr, s],
    );
  }

  return (
    <Container className="py-12 max-w-3xl space-y-4">
      <h1 className="text-3xl font-semibold tracking-tight text-navy-900 mb-2">
        API keys
      </h1>

      <Card>
        <CardHeader>
          <CardTitle>Mint a new key</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={create} className="space-y-3">
            <input
              type="text"
              required
              placeholder="key name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full border border-navy-200 rounded-md h-10 px-3"
            />
            <div className="flex gap-3 text-sm">
              {SCOPES.map((s) => (
                <label key={s} className="flex items-center gap-1">
                  <input
                    type="checkbox"
                    checked={scopes.includes(s)}
                    onChange={() => toggleScope(s)}
                  />
                  {s}
                </label>
              ))}
            </div>
            <Button type="submit">Create key</Button>
          </form>
          {created && (
            <div className="mt-3 text-sm">
              <p className="text-navy-700">
                Store this now — it won't be shown again:
              </p>
              <pre className="bg-navy-50 border border-navy-200 rounded p-2 mt-1 font-mono">
                {created}
              </pre>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Existing keys</CardTitle>
        </CardHeader>
        <CardContent className="text-sm">
          {keys.length === 0 ? (
            <p className="text-navy-700">No API keys yet.</p>
          ) : (
            <table className="w-full">
              <thead className="text-left text-navy-500 text-xs uppercase">
                <tr>
                  <th className="py-1">Name</th>
                  <th>Scopes</th>
                  <th>Created</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {keys.map((k) => (
                  <tr key={k.id} className="border-t border-navy-200">
                    <td className="py-2">{k.name}</td>
                    <td>{k.scopes.join(", ")}</td>
                    <td className="font-tabular">
                      {new Date(k.createdAt).toLocaleString()}
                    </td>
                    <td>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => revoke(k.id)}
                      >
                        Revoke
                      </Button>
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
