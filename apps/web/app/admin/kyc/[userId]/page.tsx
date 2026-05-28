"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Container } from "@/components/ui/container";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { authedFetch } from "@/lib/token-storage";

type DocRow = {
  id: string;
  type: string;
  filename: string;
  mimeType: string;
  size: number;
  source: string;
};

type View = {
  user: { id: string; email: string; displayName: string | null; kycTier: number };
  profile: {
    legalName: string | null;
    dateOfBirth: string | null;
    country: string | null;
    addressLine: string | null;
    city: string | null;
    postalCode: string | null;
    status: string;
  } | null;
  documents: DocRow[];
};

export default function AdminKycReview() {
  const router = useRouter();
  const params = useParams<{ userId: string }>();
  const userId = params.userId;
  const [view, setView] = useState<View | null>(null);
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const [tier, setTier] = useState(1);
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  async function load() {
    const res = await authedFetch(`/api/v2/admin/kyc/${userId}`);
    if (res.status === 401 || res.status === 403) {
      router.replace("/login");
      return;
    }
    setView((await res.json()) as View);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  // For each document, fetch the bytes with the admin's bearer token,
  // turn them into a Blob with the document's stored mime, and use the
  // resulting blob URL as the iframe src. Required because iframes
  // don't send the Authorization header on their own.
  useEffect(() => {
    if (!view) return;
    const cancelled = { v: false };
    (async () => {
      const next: Record<string, string> = {};
      for (const d of view.documents) {
        if (previews[d.id]) {
          next[d.id] = previews[d.id] as string;
          continue;
        }
        const res = await authedFetch(
          `/api/v2/admin/kyc/${userId}/doc/${d.id}`,
        );
        if (!res.ok) continue;
        const blob = await res.blob();
        const typed = new Blob([await blob.arrayBuffer()], { type: d.mimeType });
        next[d.id] = URL.createObjectURL(typed);
      }
      if (!cancelled.v) setPreviews((curr) => ({ ...curr, ...next }));
    })();
    return () => {
      cancelled.v = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, userId]);

  async function approve() {
    const res = await authedFetch(`/api/v2/admin/kyc/${userId}/approve`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tier }),
    });
    setMessage(res.ok ? `Approved tier ${tier}.` : "Approve failed.");
    await load();
  }

  async function reject() {
    if (!reason) return setMessage("Reason required.");
    const res = await authedFetch(`/api/v2/admin/kyc/${userId}/reject`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reason }),
    });
    setMessage(res.ok ? "Rejected." : "Reject failed.");
    await load();
  }

  if (!view) return <Container className="py-12">Loading…</Container>;

  return (
    <Container className="py-12 max-w-4xl space-y-4">
      <h1 className="text-3xl font-semibold tracking-tight text-navy-900 mb-2">
        Review: {view.user.email}
      </h1>

      <Card>
        <CardHeader>
          <CardTitle>Profile</CardTitle>
        </CardHeader>
        <CardContent className="text-sm grid sm:grid-cols-2 gap-y-1">
          <div>Legal name: {view.profile?.legalName ?? "—"}</div>
          <div>DOB: {view.profile?.dateOfBirth ?? "—"}</div>
          <div>Country: {view.profile?.country ?? "—"}</div>
          <div>City: {view.profile?.city ?? "—"}</div>
          <div className="sm:col-span-2">
            Address: {view.profile?.addressLine ?? "—"} ({view.profile?.postalCode ?? "—"})
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Documents</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {view.documents.map((d) => (
            <div key={d.id} className="border border-navy-200 rounded-md p-3">
              <div className="text-sm text-navy-700 flex justify-between">
                <span>
                  <strong>{d.type}</strong> — <span className="font-mono">{d.filename}</span>
                </span>
                <span className="text-navy-500">
                  {d.source} · {d.mimeType} · {d.size}B
                </span>
              </div>
              <iframe
                title={d.filename}
                src={previews[d.id] ?? "about:blank"}
                className="w-full h-96 mt-2 bg-white border border-navy-100"
              />
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Decision</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div className="flex items-center gap-2">
            <label>Approve at tier:</label>
            <select
              value={tier}
              onChange={(e) => setTier(Number(e.target.value))}
              className="border border-navy-200 rounded-md h-10 px-3"
            >
              <option value={1}>1</option>
              <option value={2}>2</option>
              <option value={3}>3</option>
            </select>
            <Button onClick={approve}>Approve</Button>
          </div>
          <div className="flex items-center gap-2">
            <input
              placeholder="rejection reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="flex-1 border border-navy-200 rounded-md h-10 px-3"
            />
            <Button onClick={reject} variant="secondary">
              Reject
            </Button>
          </div>
          {message && <p className="text-navy-700">{message}</p>}
        </CardContent>
      </Card>
    </Container>
  );
}
