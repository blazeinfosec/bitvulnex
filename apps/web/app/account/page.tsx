"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Container } from "@/components/ui/container";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  authedFetch,
  clearTokens,
  getRefreshToken,
  responseError,
} from "@/lib/token-storage";

type Me = {
  id: string;
  email: string;
  displayName: string | null;
  role: string;
  kycTier: number;
  emailVerified: boolean;
  totpEnabled: boolean;
};

export default function AccountPage() {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
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
          setLoadError(await responseError(res, "Could not load your account."));
          return;
        }
        setMe((await res.json()) as Me);
      } catch {
        setLoadError("Could not load your account.");
      } finally {
        setLoading(false);
      }
    })();
  }, [router]);

  async function downloadStatement() {
    const res = await authedFetch("/api/v2/me/statement");
    if (!res.ok) return;
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "bitvulnex-statement.csv";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  async function logout() {
    const refresh = getRefreshToken();
    if (refresh) {
      await fetch("/api/v2/auth/logout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ refresh }),
      });
    }
    clearTokens();
    router.replace("/");
  }

  if (loadError) {
    return (
      <Container className="py-12">
        <p className="text-sell text-sm">{loadError}</p>
      </Container>
    );
  }

  if (loading || !me) {
    return (
      <Container className="py-12">
        <p className="text-text-dim">Loading…</p>
      </Container>
    );
  }

  return (
    <Container className="py-12 max-w-3xl">
      <h1 className="text-3xl font-semibold tracking-tight text-text mb-6">
        Account
      </h1>
      <div className="grid sm:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Profile</CardTitle>
          </CardHeader>
          <CardContent className="text-sm space-y-1 text-text-dim">
            <div>
              <span className="text-text-mute">Email:</span> {me.email}
              {me.emailVerified ? " (verified)" : " (unverified)"}
            </div>
            <div>
              <span className="text-text-mute">Name:</span>{" "}
              {me.displayName ?? "—"}
            </div>
            <div>
              <span className="text-text-mute">Role:</span> {me.role}
            </div>
            <div>
              <span className="text-text-mute">KYC tier:</span> {me.kycTier}
            </div>
            <div>
              <span className="text-text-mute">2FA:</span>{" "}
              {me.totpEnabled ? "enabled" : "disabled"}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Security</CardTitle>
          </CardHeader>
          <CardContent className="text-sm space-y-2">
            <p>
              <Link href="/account/deposit">Deposit BTC →</Link>
            </p>
            <p>
              <Link href="/account/kyc">Identity verification →</Link>
            </p>
            <p>
              <Link href="/account/security">Manage password & 2FA →</Link>
            </p>
            <p>
              <Link href="/account/api-keys">Manage API keys →</Link>
            </p>
            <p>
              <Link href="/fees">Fee schedule →</Link>
            </p>
            <div className="flex flex-wrap gap-2 pt-1">
              <Button onClick={downloadStatement} variant="secondary">
                Download statement (CSV)
              </Button>
              <Button onClick={logout} variant="secondary">
                Sign out
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </Container>
  );
}
