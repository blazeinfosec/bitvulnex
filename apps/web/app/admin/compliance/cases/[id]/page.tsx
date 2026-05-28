"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Container } from "@/components/ui/container";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { authedFetch } from "@/lib/token-storage";

type Detail = {
  case: {
    id: string;
    status: string;
    notes: string | null;
    createdAt: string;
    subject: {
      id: string;
      email: string;
      displayName: string | null;
      kycTier: number;
    };
  };
  kyc: unknown;
};

export default function ComplianceCaseDetail() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const [data, setData] = useState<Detail | null>(null);
  const [exportName, setExportName] = useState("");

  async function load() {
    const res = await authedFetch(`/api/v2/admin/compliance/cases/${params.id}`);
    if (res.status === 401 || res.status === 403) {
      router.replace("/login");
      return;
    }
    setData((await res.json()) as Detail);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.id]);

  async function exportPdf() {
    const params2 = new URLSearchParams({ name: exportName || `case-${params.id}` });
    const res = await authedFetch(
      `/api/v2/admin/compliance/cases/${params.id}/export-pdf?${params2.toString()}`,
    );
    const body = await res.json();
    alert(JSON.stringify(body));
  }

  if (!data) return <Container className="py-12">Loading…</Container>;

  return (
    <Container className="py-12 max-w-3xl space-y-4">
      <h1 className="text-3xl font-semibold tracking-tight text-navy-900 mb-2">
        Case · {data.case.subject.email}
      </h1>
      <div className="text-sm text-navy-700">
        Status: {data.case.status} · Opened{" "}
        {new Date(data.case.createdAt).toLocaleString()}
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Notes</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm whitespace-pre-wrap">
            {data.case.notes ?? "—"}
          </p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Export</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={exportName}
              onChange={(e) => setExportName(e.target.value)}
              placeholder={`case-${params.id}`}
              className="flex-1 border border-navy-200 rounded px-2 py-1 text-sm"
            />
            <Button size="sm" onClick={exportPdf}>
              Export PII bundle (PDF)
            </Button>
          </div>
        </CardContent>
      </Card>
    </Container>
  );
}
