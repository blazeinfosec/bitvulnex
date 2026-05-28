"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Container } from "@/components/ui/container";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { setTokens } from "@/lib/token-storage";

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
    <Container className="py-16 max-w-md">
      <Card>
        <CardHeader>
          <CardTitle>Create account</CardTitle>
        </CardHeader>
        <CardContent>
          <form
            onSubmit={submit}
            className="space-y-3"
            aria-describedby={error ? "signup-error" : undefined}
          >
            <div>
              <label
                htmlFor="signup-email"
                className="block text-sm text-navy-700 mb-1"
              >
                Email
              </label>
              <input
                id="signup-email"
                name="email"
                type="email"
                required
                autoComplete="email"
                placeholder="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                aria-describedby={error ? "signup-error" : undefined}
                className="w-full border border-navy-200 rounded-md h-10 px-3"
              />
            </div>
            <div>
              <label
                htmlFor="signup-display-name"
                className="block text-sm text-navy-700 mb-1"
              >
                Display name
              </label>
              <input
                id="signup-display-name"
                name="displayName"
                type="text"
                required
                maxLength={64}
                placeholder="display name"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                aria-describedby={error ? "signup-error" : undefined}
                className="w-full border border-navy-200 rounded-md h-10 px-3"
              />
            </div>
            <div>
              <label
                htmlFor="signup-password"
                className="block text-sm text-navy-700 mb-1"
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
                placeholder="password (min 8 chars)"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                aria-describedby={error ? "signup-error" : undefined}
                className="w-full border border-navy-200 rounded-md h-10 px-3"
              />
            </div>
            {error && (
              <p id="signup-error" role="alert" className="text-sm text-danger">
                {error}
              </p>
            )}
            <Button type="submit" className="w-full">
              Create account
            </Button>
            <p className="text-sm text-navy-700">
              Already have an account? <Link href="/login">Sign in</Link>
            </p>
          </form>
        </CardContent>
      </Card>
    </Container>
  );
}
