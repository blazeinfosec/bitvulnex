"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Container } from "@/components/ui/container";
import { authedFetch } from "@/lib/token-storage";
import { DataTable, type Column, EmptyState, Modal } from "@/components/exchange";

type ApiKeyListItem = {
  id: string;
  name: string;
  scopes: string[];
  createdAt: string;
  lastUsedAt: string | null;
};

const SCOPES = ["read", "trade", "withdraw"] as const;

const inputClass =
  "w-full h-10 px-3 rounded-md bg-bg border border-border text-text placeholder:text-text-mute focus:outline-none focus:ring-2 focus:ring-accent focus:border-accent transition-colors";

const primaryBtn =
  "inline-flex items-center justify-center h-10 px-4 rounded-md bg-accent text-accent-fg hover:bg-accent-hover transition-colors font-semibold text-sm";
const secondaryBtn =
  "inline-flex items-center justify-center h-9 px-3 rounded-md bg-bg border border-border text-text hover:bg-bg-hover transition-colors text-sm";
const dangerBtn =
  "inline-flex items-center justify-center h-9 px-3 rounded-md bg-sell/20 border border-sell/40 text-sell hover:bg-sell/30 transition-colors text-sm";

export default function ApiKeysPage() {
  const router = useRouter();
  const [keys, setKeys] = useState<ApiKeyListItem[]>([]);
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<string[]>(["read"]);
  const [created, setCreated] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

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

  const cols: Column<ApiKeyListItem>[] = [
    {
      key: "name",
      header: "Name",
      render: (k) => <span className="text-text">{k.name}</span>,
    },
    {
      key: "scopes",
      header: "Scopes",
      render: (k) => (
        <div className="flex flex-wrap gap-1">
          {k.scopes.map((s) => (
            <span
              key={s}
              className="inline-block px-2 py-0.5 text-[10px] uppercase tracking-wider rounded bg-bg border border-border text-text-dim font-mono"
            >
              {s}
            </span>
          ))}
        </div>
      ),
    },
    {
      key: "created",
      header: "Created",
      render: (k) => (
        <span className="font-mono text-xs text-text-mute">
          {new Date(k.createdAt).toISOString().replace("T", " ").slice(0, 19)} UTC
        </span>
      ),
    },
    {
      key: "lastUsed",
      header: "Last used",
      render: (k) => (
        <span className="font-mono text-xs text-text-mute">
          {k.lastUsedAt
            ? new Date(k.lastUsedAt)
                .toISOString()
                .replace("T", " ")
                .slice(0, 19) + " UTC"
            : "never"}
        </span>
      ),
    },
    {
      key: "action",
      header: "",
      align: "right",
      render: (k) => (
        <button
          type="button"
          className={dangerBtn}
          onClick={() => revoke(k.id)}
        >
          Revoke
        </button>
      ),
    },
  ];

  return (
    <Container className="py-10 max-w-4xl space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-text">
            API keys
          </h1>
          <p className="text-sm text-text-dim mt-1">
            Mint scoped credentials for programmatic access. Treat them like
            passwords — they grant the listed permissions on your account.
          </p>
        </div>
        <button type="button" className={primaryBtn} onClick={() => setOpen(true)}>
          + Create key
        </button>
      </div>

      <nav className="flex gap-1 border-b border-border">
        <a
          href="/account/profile"
          className="px-4 py-2 text-sm font-medium text-text-dim hover:text-text border-b-2 border-transparent hover:border-border -mb-px"
        >
          Profile
        </a>
        <a
          href="/account/security"
          className="px-4 py-2 text-sm font-medium text-text-dim hover:text-text border-b-2 border-transparent hover:border-border -mb-px"
        >
          Security
        </a>
        <a
          href="/account/kyc"
          className="px-4 py-2 text-sm font-medium text-text-dim hover:text-text border-b-2 border-transparent hover:border-border -mb-px"
        >
          KYC
        </a>
        <a
          href="/account/api-keys"
          className="px-4 py-2 text-sm font-medium text-text border-b-2 border-accent -mb-px"
        >
          API keys
        </a>
      </nav>

      {created && (
        <div className="rounded-lg border border-warn/40 bg-warn/10 p-4 space-y-2">
          <p className="text-sm text-warn font-semibold">
            Store this key now. It will not be shown again.
          </p>
          <pre className="text-xs bg-bg border border-border rounded-md p-3 overflow-x-auto font-mono text-text">
            {created}
          </pre>
          <button
            type="button"
            className={secondaryBtn}
            onClick={() => setCreated(null)}
          >
            Dismiss
          </button>
        </div>
      )}

      <DataTable<ApiKeyListItem>
        columns={cols}
        rows={keys}
        rowKey={(k) => k.id}
        empty={
          <EmptyState
            title="No API keys yet"
            description="Mint a key to access the API programmatically."
            action={{
              label: "+ Create your first key",
              onClick: () => setOpen(true),
            }}
          />
        }
      />

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Create API key"
        description="Pick a clear name and the minimum scopes you need."
        footer={
          <>
            <button
              type="button"
              className={secondaryBtn}
              onClick={() => setOpen(false)}
            >
              Cancel
            </button>
            <button
              type="button"
              className={primaryBtn}
              onClick={(e) => {
                create(e as unknown as React.FormEvent);
                setOpen(false);
              }}
              disabled={!name || scopes.length === 0}
            >
              Create key
            </button>
          </>
        }
      >
        <div className="space-y-4">
          <div>
            <label className="block text-xs uppercase tracking-wider text-text-mute mb-1.5 font-medium">
              Name
            </label>
            <input
              required
              placeholder="e.g. trading-bot-prod"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={inputClass}
            />
          </div>
          <div>
            <label className="block text-xs uppercase tracking-wider text-text-mute mb-1.5 font-medium">
              Scopes
            </label>
            <div className="flex flex-wrap gap-2">
              {SCOPES.map((s) => (
                <label
                  key={s}
                  className={
                    "inline-flex items-center gap-2 px-3 py-1.5 rounded-md border cursor-pointer text-sm transition-colors " +
                    (scopes.includes(s)
                      ? "bg-accent/10 border-accent text-text"
                      : "border-border text-text-dim hover:bg-bg-hover")
                  }
                >
                  <input
                    type="checkbox"
                    checked={scopes.includes(s)}
                    onChange={() => toggleScope(s)}
                    className="accent-accent"
                  />
                  <span className="font-mono uppercase text-xs">{s}</span>
                </label>
              ))}
            </div>
          </div>
        </div>
      </Modal>
    </Container>
  );
}
