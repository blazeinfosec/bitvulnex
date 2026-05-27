"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Container } from "@/components/ui/container";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function ResetPage() {
  const router = useRouter();
  const params = useSearchParams();
  const token = params.get("token") ?? "";
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const res = await fetch("/api/v2/auth/password-reset/confirm", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token, newPassword: password }),
    });
    if (!res.ok) {
      setError("Token expired or invalid.");
      return;
    }
    router.push("/login" as "/login");
  }

  return (
    <Container className="py-16 max-w-md">
      <Card>
        <CardHeader>
          <CardTitle>Set a new password</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="space-y-3">
            <input
              type="password"
              required
              minLength={8}
              placeholder="new password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full border border-navy-200 rounded-md h-10 px-3"
            />
            {error && <p className="text-sm text-danger">{error}</p>}
            <Button type="submit" className="w-full">
              Update password
            </Button>
          </form>
        </CardContent>
      </Card>
    </Container>
  );
}
