"use client";

import { useState } from "react";
import Link from "next/link";
import { Container } from "@/components/ui/container";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function ForgotPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    await fetch("/api/v2/auth/password-reset/request", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email }),
    });
    setSent(true);
  }

  return (
    <Container className="py-16 max-w-md">
      <Card>
        <CardHeader>
          <CardTitle>Reset password</CardTitle>
        </CardHeader>
        <CardContent>
          {sent ? (
            <p className="text-sm text-text-dim">
              If an account exists for that email, a reset link has been issued.
              In this lab, the reset URL is printed to the server console.
            </p>
          ) : (
            <form onSubmit={submit} className="space-y-3">
              <p className="text-sm text-text-dim">
                Enter your account email and we&apos;ll send a
                password-reset link.
              </p>
              <input
                type="email"
                required
                autoComplete="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full border border-border rounded-md h-10 px-3 bg-bg text-text placeholder:text-text-mute focus:outline-none focus:ring-2 focus:ring-accent focus:border-accent transition-colors"
              />
              <Button type="submit" className="w-full">
                Send reset link
              </Button>
              <p className="text-sm text-text-dim">
                Remembered it? <Link href="/login">Sign in</Link>
              </p>
            </form>
          )}
        </CardContent>
      </Card>
    </Container>
  );
}
