"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Container } from "@/components/ui/container";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { authedFetch } from "@/lib/token-storage";

export default function AdminLanding() {
  const router = useRouter();
  const [ok, setOk] = useState(false);

  useEffect(() => {
    (async () => {
      const res = await authedFetch("/api/v2/admin/kyc/queue");
      if (res.status === 401 || res.status === 403) {
        router.replace("/login");
        return;
      }
      setOk(true);
    })();
  }, [router]);

  if (!ok) return <Container className="py-12">Loading…</Container>;

  return (
    <Container className="py-12 max-w-3xl space-y-4">
      <h1 className="text-3xl font-semibold tracking-tight text-navy-900 mb-2">
        Admin
      </h1>
      <div className="grid sm:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Users</CardTitle>
          </CardHeader>
          <CardContent className="text-sm">
            <Link href="/admin/users">Search users →</Link>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Support inbox</CardTitle>
          </CardHeader>
          <CardContent className="text-sm">
            <Link href="/admin/tickets">Open the ticket inbox →</Link>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Compliance queue</CardTitle>
          </CardHeader>
          <CardContent className="text-sm">
            <Link href="/admin/compliance">Open the compliance queue →</Link>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>KYC review queue</CardTitle>
          </CardHeader>
          <CardContent className="text-sm">
            <Link href="/admin/kyc">Open the pending-review queue →</Link>
          </CardContent>
        </Card>
      </div>
    </Container>
  );
}
