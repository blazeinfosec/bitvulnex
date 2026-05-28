"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { setTokens } from "@/lib/token-storage";

export function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const nextPath = params.get("next") ?? "/account";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [stage, setStage] = useState<"password" | "totp">("password");
  const [ticket, setTicket] = useState<string | null>(null);
  const [code, setCode] = useState("");

  async function submitPassword(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const res = await fetch("/api/v2/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    if (!res.ok) {
      setError("Invalid email or password.");
      return;
    }
    const body = (await res.json()) as
      | { totpRequired: true; ticket: string }
      | { access: string; refresh: string };
    if ("totpRequired" in body) {
      setTicket(body.ticket);
      setStage("totp");
      return;
    }
    setTokens(body.access, body.refresh);
    router.push(nextPath as Parameters<typeof router.push>[0]);
  }

  async function submitTotp(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const res = await fetch("/api/v2/auth/login/totp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ticket, code }),
    });
    if (!res.ok) {
      setError("Invalid code.");
      return;
    }
    const body = (await res.json()) as { access: string; refresh: string };
    setTokens(body.access, body.refresh);
    router.push(nextPath as Parameters<typeof router.push>[0]);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Sign in</CardTitle>
      </CardHeader>
      <CardContent>
        {stage === "password" ? (
          <form
            onSubmit={submitPassword}
            className="space-y-3"
            aria-describedby={error ? "login-error" : undefined}
          >
            <div>
              <label
                htmlFor="login-email"
                className="block text-sm text-navy-700 mb-1"
              >
                Email
              </label>
              <input
                id="login-email"
                name="email"
                type="email"
                required
                autoComplete="email"
                placeholder="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                aria-describedby={error ? "login-error" : undefined}
                className="w-full border border-navy-200 rounded-md h-10 px-3"
              />
            </div>
            <div>
              <label
                htmlFor="login-password"
                className="block text-sm text-navy-700 mb-1"
              >
                Password
              </label>
              <input
                id="login-password"
                name="password"
                type="password"
                required
                autoComplete="current-password"
                placeholder="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                aria-describedby={error ? "login-error" : undefined}
                className="w-full border border-navy-200 rounded-md h-10 px-3"
              />
            </div>
            {error && (
              <p id="login-error" role="alert" className="text-sm text-danger">
                {error}
              </p>
            )}
            <div className="flex items-center justify-between">
              <Button type="submit">Sign in</Button>
              <Link href="/forgot" className="text-sm">
                Forgot password?
              </Link>
            </div>
            <p className="text-sm text-navy-700">
              No account? <Link href="/signup">Create one</Link>
            </p>
          </form>
        ) : (
          <form onSubmit={submitTotp} className="space-y-3">
            <p className="text-sm text-navy-700">
              Enter the 6-digit code from your authenticator app.
            </p>
            <label htmlFor="login-totp" className="sr-only">
              Authenticator code
            </label>
            <input
              id="login-totp"
              name="code"
              inputMode="numeric"
              pattern="\d{6}"
              required
              aria-label="Authenticator code"
              placeholder="123456"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              className="w-full border border-navy-200 rounded-md h-10 px-3 font-mono tracking-widest"
            />
            {error && <p className="text-sm text-danger">{error}</p>}
            <Button type="submit">Verify</Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
