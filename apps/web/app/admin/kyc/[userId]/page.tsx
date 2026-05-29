"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
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

const inputClass =
  "h-10 px-3 rounded-md bg-bg border border-border text-text placeholder:text-text-mute focus:outline-none focus:ring-2 focus:ring-accent focus:border-accent transition-colors";

const primaryBtn =
  "inline-flex items-center justify-center h-10 px-4 rounded-md bg-accent text-accent-fg hover:bg-accent-hover transition-colors font-semibold text-sm";
const secondaryBtn =
  "inline-flex items-center justify-center h-9 px-3 rounded-md bg-bg border border-border text-text hover:bg-bg-hover transition-colors text-sm";
const dangerBtn =
  "inline-flex items-center justify-center h-9 px-3 rounded-md bg-sell/20 border border-sell/40 text-sell hover:bg-sell/30 transition-colors text-sm";

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

  if (!view) return <p className="text-text-dim">Loading…</p>;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-text">
          Review: <span className="font-mono">{view.user.email}</span>
        </h1>
        <p className="text-sm text-text-dim mt-1">
          Current tier: {view.user.kycTier} · Status:{" "}
          <span className="text-text">{view.profile?.status ?? "—"}</span>
        </p>
      </div>

      <section className="rounded-lg border border-border bg-bg-elevated p-5">
        <h2 className="text-sm font-semibold text-text mb-4">Profile</h2>
        <dl className="grid sm:grid-cols-2 gap-y-3 gap-x-4 text-sm">
          <Item label="Legal name" value={view.profile?.legalName ?? "—"} />
          <Item label="Date of birth" value={view.profile?.dateOfBirth ?? "—"} />
          <Item label="Country" value={view.profile?.country ?? "—"} />
          <Item label="City" value={view.profile?.city ?? "—"} />
          <div className="sm:col-span-2">
            <Item
              label="Address"
              value={
                <>
                  {view.profile?.addressLine ?? "—"}
                  {view.profile?.postalCode
                    ? ` (${view.profile.postalCode})`
                    : ""}
                </>
              }
            />
          </div>
        </dl>
      </section>

      <section>
        <h2 className="text-xs uppercase tracking-wider text-text-mute font-medium mb-2">
          Documents ({view.documents.length})
        </h2>
        <div className="space-y-4">
          {view.documents.map((d) => (
            <div
              key={d.id}
              className="rounded-lg border border-border bg-bg-elevated p-4"
            >
              <div className="flex items-center justify-between text-sm">
                <div>
                  <span className="inline-block px-2 py-0.5 text-[10px] uppercase tracking-wider rounded bg-bg border border-border text-text-dim font-medium mr-2">
                    {d.type}
                  </span>
                  <span className="font-mono text-text">{d.filename}</span>
                </div>
                <div className="text-xs text-text-mute font-mono">
                  {d.source} · {d.mimeType} · {d.size}B
                </div>
              </div>
              <iframe
                title={d.filename}
                src={previews[d.id] ?? "about:blank"}
                className="w-full h-96 mt-3 bg-white border border-border-subtle rounded-md"
              />
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-lg border border-border bg-bg-elevated p-5 space-y-4">
        <h2 className="text-sm font-semibold text-text">Decision</h2>

        <div className="flex flex-wrap items-center gap-2">
          <label className="text-xs uppercase tracking-wider text-text-mute font-medium">
            Approve at tier
          </label>
          <select
            value={tier}
            onChange={(e) => setTier(Number(e.target.value))}
            className={inputClass + " w-20"}
          >
            <option value={1}>1</option>
            <option value={2}>2</option>
            <option value={3}>3</option>
          </select>
          <button type="button" className={primaryBtn} onClick={approve}>
            Approve
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2 pt-3 border-t border-border-subtle">
          <input
            placeholder="rejection reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className={inputClass + " flex-1 min-w-[200px]"}
          />
          <button type="button" className={dangerBtn} onClick={reject}>
            Reject
          </button>
        </div>

        {message && (
          <p className="text-sm text-text-dim border-t border-border-subtle pt-3">
            {message}
          </p>
        )}
      </section>
    </div>
  );
}

function Item({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wider text-text-mute font-medium mb-0.5">
        {label}
      </dt>
      <dd className="text-text">{value}</dd>
    </div>
  );
}
