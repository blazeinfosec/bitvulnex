"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Container } from "@/components/ui/container";
import { authedFetch } from "@/lib/token-storage";

const inputClass =
  "w-full h-10 px-3 rounded-md bg-bg border border-border text-text placeholder:text-text-mute font-mono focus:outline-none focus:ring-2 focus:ring-accent focus:border-accent transition-colors";

const primaryBtn =
  "inline-flex items-center justify-center h-10 px-4 rounded-md bg-accent text-accent-fg hover:bg-accent-hover transition-colors font-semibold text-sm";
const secondaryBtn =
  "inline-flex items-center justify-center h-9 px-3 rounded-md bg-bg border border-border text-text hover:bg-bg-hover transition-colors text-sm";

export default function SecurityPage() {
  const router = useRouter();
  const [me, setMe] = useState<{ totpEnabled: boolean } | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [uri, setUri] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const res = await authedFetch("/api/v2/me");
      if (res.status === 401) {
        router.replace("/login");
        return;
      }
      setMe(await res.json());
    })();
  }, [router]);

  async function enable() {
    const res = await authedFetch("/api/v2/auth/2fa/enable", {
      method: "POST",
    });
    const body = await res.json();
    setSecret(body.secret);
    setUri(body.uri);
  }

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    const res = await authedFetch("/api/v2/auth/2fa/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code }),
    });
    if (res.ok) {
      setMessage("2FA enabled.");
      setMe((m) => (m ? { ...m, totpEnabled: true } : m));
      setSecret(null);
      setUri(null);
    } else {
      setMessage("Invalid code.");
    }
  }

  return (
    <Container className="py-10 max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-text">
          Security
        </h1>
        <p className="text-sm text-text-dim mt-1">
          Manage authentication, two-factor, and API access for this account.
        </p>
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
          className="px-4 py-2 text-sm font-medium text-text border-b-2 border-accent -mb-px"
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

      <section className="rounded-lg border border-border bg-bg-elevated p-6 space-y-4">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-sm font-semibold text-text">
              Two-factor authentication
            </h2>
            <p className="text-xs text-text-dim mt-1">
              Require a TOTP code at sign-in. Recommended.
            </p>
          </div>
          {me?.totpEnabled ? (
            <span className="inline-block px-2 py-0.5 text-xs uppercase tracking-wider rounded bg-buy/20 text-buy font-semibold">
              Enabled
            </span>
          ) : (
            <span className="inline-block px-2 py-0.5 text-xs uppercase tracking-wider rounded bg-warn/20 text-warn font-semibold">
              Disabled
            </span>
          )}
        </div>

        {me?.totpEnabled ? (
          <p className="text-sm text-text-dim">
            Two-factor authentication is enabled on this account.
          </p>
        ) : secret ? (
          <div className="space-y-3">
            <p className="text-sm text-text-dim">
              Scan this URI in your authenticator app, then enter the 6-digit
              code to confirm.
            </p>
            <pre className="text-xs bg-bg border border-border rounded-md p-3 overflow-x-auto text-text font-mono">
              {uri}
            </pre>
            <p className="text-xs text-text-mute">
              Manual entry secret:{" "}
              <code className="text-text font-mono">{secret}</code>
            </p>
            <form onSubmit={verify} className="flex flex-wrap gap-2">
              <input
                inputMode="numeric"
                pattern="\d{6}"
                required
                placeholder="123456"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                className={inputClass + " w-32 tracking-widest text-center"}
              />
              <button type="submit" className={primaryBtn}>
                Verify
              </button>
            </form>
          </div>
        ) : (
          <button type="button" className={primaryBtn} onClick={enable}>
            Enable 2FA
          </button>
        )}
        {message && <p className="text-sm text-text-dim">{message}</p>}
      </section>

      <section className="rounded-lg border border-border bg-bg-elevated p-6 space-y-3">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-sm font-semibold text-text">Password</h2>
            <p className="text-xs text-text-dim mt-1">
              Reset via emailed link.
            </p>
          </div>
          <Link
            href="/forgot"
            className={secondaryBtn}
          >
            Reset password
          </Link>
        </div>
      </section>

      <section className="rounded-lg border border-border bg-bg-elevated p-6 space-y-3">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-sm font-semibold text-text">API keys</h2>
            <p className="text-xs text-text-dim mt-1">
              Mint, rotate, and revoke programmatic credentials.
            </p>
          </div>
          <Link href="/account/api-keys" className={secondaryBtn}>
            Manage keys
          </Link>
        </div>
      </section>
    </Container>
  );
}
