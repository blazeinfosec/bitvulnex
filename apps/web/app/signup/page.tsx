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
          <form onSubmit={submit} className="space-y-3">
            <input
              type="email"
              required
              autoComplete="email"
              placeholder="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full border border-navy-200 rounded-md h-10 px-3"
            />
            <input
              type="text"
              required
              maxLength={64}
              placeholder="display name"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className="w-full border border-navy-200 rounded-md h-10 px-3"
            />
            <input
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
              placeholder="password (min 8 chars)"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full border border-navy-200 rounded-md h-10 px-3"
            />
            {error && <p className="text-sm text-danger">{error}</p>}
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
