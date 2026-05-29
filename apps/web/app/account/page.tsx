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

  useEffect(() => {
    (async () => {
      const res = await authedFetch("/api/v2/me");
      if (res.status === 401) {
        router.replace("/login");
        return;
      }
      setMe((await res.json()) as Me);
      setLoading(false);
    })();
  }, [router]);

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
            <Button onClick={logout} variant="secondary">
              Sign out
            </Button>
          </CardContent>
        </Card>
      </div>
    </Container>
  );
}
