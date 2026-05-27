"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Container } from "@/components/ui/container";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { authedFetch } from "@/lib/token-storage";

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
    const res = await authedFetch("/api/v2/auth/2fa/enable", { method: "POST" });
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
    <Container className="py-12 max-w-2xl space-y-4">
      <h1 className="text-3xl font-semibold tracking-tight text-navy-900 mb-2">
        Security
      </h1>

      <Card>
        <CardHeader>
          <CardTitle>Two-factor authentication</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {me?.totpEnabled ? (
            <p>2FA is enabled on this account.</p>
          ) : secret ? (
            <>
              <p className="text-navy-700">
                Scan this URI in your authenticator app and enter the resulting
                6-digit code below.
              </p>
              <pre className="text-xs bg-navy-50 border border-navy-200 rounded p-2 overflow-x-auto">
                {uri}
              </pre>
              <p className="text-xs text-navy-500">
                Secret (for manual entry): <code>{secret}</code>
              </p>
              <form onSubmit={verify} className="flex gap-2">
                <input
                  inputMode="numeric"
                  pattern="\d{6}"
                  required
                  placeholder="123456"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  className="border border-navy-200 rounded-md h-10 px-3 font-mono"
                />
                <Button type="submit">Verify</Button>
              </form>
            </>
          ) : (
            <Button onClick={enable}>Enable 2FA</Button>
          )}
          {message && <p className="text-sm text-navy-700">{message}</p>}
        </CardContent>
      </Card>
    </Container>
  );
}
