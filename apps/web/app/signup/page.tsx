"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Wordmark } from "@/components/exchange/Wordmark";
import { setTokens } from "@/lib/token-storage";

const inputClass =
  "w-full h-10 px-3 rounded-md bg-bg border border-border text-text placeholder:text-text-mute focus:outline-none focus:ring-2 focus:ring-accent focus:border-accent transition-colors";

export default function SignupPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const res = await fetch("/api/v2/auth/signup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password, displayName }),
    });
    if (!res.ok) {
      const body = (await res
        .json()
        .catch(() => ({}))) as { error?: { message?: string } };
      setError(body.error?.message ?? "Signup failed.");
      return;
    }
    const body = (await res.json()) as { access: string; refresh: string };
    setTokens(body.access, body.refresh);
    router.push("/account");
  }

  return (
    <div className="flex items-start justify-center px-4 py-16">
      <div className="w-full max-w-md">
        <div className="rounded-lg border border-border bg-bg-elevated shadow-elevated p-8">
          <div className="flex flex-col items-center gap-2 mb-6">
            <Wordmark />
            <h1 className="text-lg font-semibold text-text tracking-tight">
              Create account
            </h1>
            <p className="text-xs text-text-mute">
              Authorized lab access only. No real funds.
            </p>
          </div>
          <form
            onSubmit={submit}
            className="space-y-4"
            aria-describedby={error ? "signup-error" : undefined}
          >
            <div>
              <label
                htmlFor="signup-email"
                className="block text-xs uppercase tracking-wider text-text-mute mb-1.5 font-medium"
              >
                Email
              </label>
              <input
                id="signup-email"
                name="email"
                type="email"
                required
                autoComplete="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                aria-describedby={error ? "signup-error" : undefined}
                className={inputClass}
              />
            </div>
            <div>
              <label
                htmlFor="signup-display-name"
                className="block text-xs uppercase tracking-wider text-text-mute mb-1.5 font-medium"
              >
                Display name
              </label>
              <input
                id="signup-display-name"
                name="displayName"
                type="text"
                required
                maxLength={64}
                placeholder="Ada Lovelace"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                aria-describedby={error ? "signup-error" : undefined}
                className={inputClass}
              />
            </div>
            <div>
              <label
                htmlFor="signup-password"
                className="block text-xs uppercase tracking-wider text-text-mute mb-1.5 font-medium"
              >
                Password
              </label>
              <input
                id="signup-password"
                name="password"
                type="password"
                required
                minLength={8}
                autoComplete="new-password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                aria-describedby={error ? "signup-error" : undefined}
                className={inputClass}
              />
              <p className="text-2xs text-text-mute mt-1">
                Minimum 8 characters.
              </p>
            </div>
            {error && (
              <div
                id="signup-error"
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
              Create account
            </button>
            <p className="text-sm text-text-dim text-center pt-1">
              Already have an account?{" "}
              <Link
                href="/login"
                className="text-text-dim hover:text-accent no-underline"
              >
                Sign in →
              </Link>
            </p>
          </form>
        </div>
      </div>
    </div>
  );
}
