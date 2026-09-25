"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Container } from "@/components/ui/container";
import { authedFetch, responseError } from "@/lib/token-storage";

type Me = {
  id: string;
  email: string;
  displayName: string | null;
  role: string;
  kycTier: number;
  totpEnabled: boolean;
};

const inputClass =
  "w-full h-10 px-3 rounded-md bg-bg border border-border text-text placeholder:text-text-mute focus:outline-none focus:ring-2 focus:ring-accent focus:border-accent transition-colors";

const primaryBtn =
  "inline-flex items-center justify-center h-10 px-4 rounded-md bg-accent text-accent-fg hover:bg-accent-hover transition-colors font-semibold text-sm";

export default function ProfilePage() {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await authedFetch("/api/v2/me");
        if (res.status === 401) {
          router.replace("/login");
          return;
        }
        if (!res.ok) {
          setLoadError(await responseError(res, "Could not load your profile."));
          return;
        }
        const body = (await res.json()) as Me;
        setMe(body);
        setDisplayName(body.displayName ?? "");
      } catch {
        setLoadError("Could not load your profile.");
      }
    })();
  }, [router]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setMessage(null);
    const res = await authedFetch("/api/v2/me", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ displayName }),
    });
    if (!res.ok) {
      setError(await responseError(res, "Save failed."));
      return;
    }
    const body = (await res.json().catch(() => ({}))) as
      | { user?: Partial<Me> }
      | Partial<Me>;
    const updated: Partial<Me> =
      "user" in body && body.user ? body.user : (body as Partial<Me>);
    setMe((m) => ({ ...m!, ...updated }));
    setMessage("Profile saved.");
  }

  if (loadError) {
    return (
      <Container className="py-10">
        <p className="text-sell text-sm">{loadError}</p>
      </Container>
    );
  }

  if (!me) {
    return (
      <Container className="py-10">
        <p className="text-text-dim">Loading…</p>
      </Container>
    );
  }

  return (
    <Container className="py-10 max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-text">
          Profile
        </h1>
        <p className="text-sm text-text-dim mt-1">
          Manage your account display name and review your role.
        </p>
      </div>

      <nav className="flex gap-1 border-b border-border">
        <a
          href="/account/profile"
          className="px-4 py-2 text-sm font-medium text-text border-b-2 border-accent -mb-px"
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
          className="px-4 py-2 text-sm font-medium text-text-dim hover:text-text border-b-2 border-transparent hover:border-border -mb-px"
        >
          API keys
        </a>
      </nav>

      {error && (
        <div className="rounded-md border border-sell/40 bg-sell/10 text-sell px-3 py-2 text-sm">
          {error}
        </div>
      )}
      {message && (
        <div className="rounded-md border border-buy/40 bg-buy/10 text-buy px-3 py-2 text-sm">
          {message}
        </div>
      )}

      <section className="rounded-lg border border-border bg-bg-elevated p-6 space-y-4">
        <h2 className="text-sm font-semibold text-text">Account details</h2>
        <dl className="grid sm:grid-cols-2 gap-4 text-sm">
          <div>
            <dt className="text-xs uppercase tracking-wider text-text-mute font-medium mb-1">
              Email
            </dt>
            <dd className="text-text font-mono">{me.email}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wider text-text-mute font-medium mb-1">
              Role
            </dt>
            <dd>
              <span className="inline-block px-2 py-0.5 text-xs uppercase tracking-wider rounded bg-bg border border-border text-text-dim font-medium">
                {me.role}
              </span>
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wider text-text-mute font-medium mb-1">
              KYC tier
            </dt>
            <dd className="text-text font-mono">Tier {me.kycTier}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wider text-text-mute font-medium mb-1">
              2FA
            </dt>
            <dd>
              {me.totpEnabled ? (
                <span className="text-buy text-sm">Enabled</span>
              ) : (
                <Link
                  href="/account/security"
                  className="text-accent text-sm hover:underline"
                >
                  Set up 2FA →
                </Link>
              )}
            </dd>
          </div>
        </dl>
      </section>

      <section className="rounded-lg border border-border bg-bg-elevated p-6">
        <h2 className="text-sm font-semibold text-text mb-4">Display name</h2>
        <form onSubmit={save} className="space-y-4">
          <div>
            <label className="block text-xs uppercase tracking-wider text-text-mute mb-1.5 font-medium">
              Display name
            </label>
            <input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className={inputClass}
              placeholder="How others see you"
            />
            <p className="mt-1.5 text-xs text-text-mute">
              Visible to support agents and on P2P offers.
            </p>
          </div>
          <button type="submit" className={primaryBtn}>
            Save changes
          </button>
        </form>
      </section>
    </Container>
  );
}
