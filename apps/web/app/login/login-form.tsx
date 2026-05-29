"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Wordmark } from "@/components/exchange/Wordmark";
import { setTokens } from "@/lib/token-storage";

const inputClass =
  "w-full h-10 px-3 rounded-md bg-bg border border-border text-text placeholder:text-text-mute focus:outline-none focus:ring-2 focus:ring-accent focus:border-accent transition-colors";

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
    <div className="rounded-lg border border-border bg-bg-elevated shadow-elevated p-8">
      <div className="flex flex-col items-center gap-2 mb-6">
        <Wordmark />
        <h1 className="text-lg font-semibold text-text tracking-tight">
          Sign in
        </h1>
        <p className="text-xs text-text-mute">
          Welcome back. Authorized lab access only.
        </p>
      </div>

      {stage === "password" ? (
        <form
          onSubmit={submitPassword}
          className="space-y-4"
          aria-describedby={error ? "login-error" : undefined}
        >
          <div>
            <label
              htmlFor="login-email"
              className="block text-xs uppercase tracking-wider text-text-mute mb-1.5 font-medium"
            >
              Email
            </label>
            <input
              id="login-email"
              name="email"
              type="email"
              required
              autoComplete="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              aria-describedby={error ? "login-error" : undefined}
              className={inputClass}
            />
          </div>
          <div>
            <label
              htmlFor="login-password"
              className="block text-xs uppercase tracking-wider text-text-mute mb-1.5 font-medium"
            >
              Password
            </label>
            <input
              id="login-password"
              name="password"
              type="password"
              required
              autoComplete="current-password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              aria-describedby={error ? "login-error" : undefined}
              className={inputClass}
            />
          </div>
          {error && (
            <div
              id="login-error"
              role="alert"
              className="rounded-md border border-sell/40 bg-sell/10 text-sell px-3 py-2 text-sm"
            >
              {error}
            </div>
          )}
          <button
            type="submit"
            className="w-full inline-flex items-center justify-center h-10 px-4 rounded-md bg-accent text-accent-fg hover:bg-accent-hover transition-colors font-semibold"
          >
            Sign in
          </button>
          <div className="flex items-center justify-between text-sm pt-1">
            <Link
              href="/forgot"
              className="text-text-dim hover:text-accent no-underline"
            >
              Forgot password?
            </Link>
            <Link
              href="/signup"
              className="text-text-dim hover:text-accent no-underline"
            >
              Don&apos;t have an account? Sign up →
            </Link>
          </div>
        </form>
      ) : (
        <form onSubmit={submitTotp} className="space-y-4">
          <p className="text-sm text-text-dim">
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
            className={`${inputClass} font-mono tracking-widest text-center text-lg`}
          />
          {error && (
            <div
              role="alert"
              className="rounded-md border border-sell/40 bg-sell/10 text-sell px-3 py-2 text-sm"
            >
              {error}
            </div>
          )}
          <button
            type="submit"
            className="w-full inline-flex items-center justify-center h-10 px-4 rounded-md bg-accent text-accent-fg hover:bg-accent-hover transition-colors font-semibold"
          >
            Verify
          </button>
        </form>
      )}
    </div>
  );
}
