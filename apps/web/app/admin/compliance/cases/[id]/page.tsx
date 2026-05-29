"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
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

const inputClass =
  "h-10 px-3 rounded-md bg-bg border border-border text-text placeholder:text-text-mute focus:outline-none focus:ring-2 focus:ring-accent focus:border-accent transition-colors";

const primaryBtn =
  "inline-flex items-center justify-center h-10 px-4 rounded-md bg-accent text-accent-fg hover:bg-accent-hover transition-colors font-semibold text-sm";

export default function ComplianceCaseDetail() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const [data, setData] = useState<Detail | null>(null);
  const [exportName, setExportName] = useState("");

  async function load() {
    const res = await authedFetch(
      `/api/v2/admin/compliance/cases/${params.id}`,
    );
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
    // V-17 reach: the `name` query parameter flows to the PDF export
    // route which feeds it to a shell command. UI just calls the endpoint.
    const params2 = new URLSearchParams({
      name: exportName || `case-${params.id}`,
    });
    const res = await authedFetch(
      `/api/v2/admin/compliance/cases/${params.id}/export-pdf?${params2.toString()}`,
    );
    const body = await res.json();
    alert(JSON.stringify(body));
  }

  if (!data) return <p className="text-text-dim">Loading…</p>;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-text">
          Case · <span className="font-mono">{data.case.subject.email}</span>
        </h1>
        <div className="text-sm text-text-dim mt-1">
          Status: <span className="text-text">{data.case.status}</span> · Opened{" "}
          <span className="font-mono">
            {new Date(data.case.createdAt)
              .toISOString()
              .replace("T", " ")
              .slice(0, 19)}{" "}
            UTC
          </span>
        </div>
      </div>

      <section className="rounded-lg border border-border bg-bg-elevated p-5">
        <h2 className="text-sm font-semibold text-text mb-3">Case notes</h2>
        <p className="text-sm whitespace-pre-wrap text-text-dim">
          {data.case.notes ?? "—"}
        </p>
      </section>

      <section className="rounded-lg border border-border bg-bg-elevated p-5 space-y-3">
        <h2 className="text-sm font-semibold text-text">Export PII bundle</h2>
        <p className="text-xs text-text-mute">
          Generates a PDF dossier (subject identity, KYC docs, related
          activity) named with the provided filename.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="text"
            value={exportName}
            onChange={(e) => setExportName(e.target.value)}
            placeholder={`case-${params.id}`}
            className={inputClass + " flex-1 min-w-[240px] font-mono"}
          />
          <button type="button" className={primaryBtn} onClick={exportPdf}>
            Export PDF
          </button>
        </div>
      </section>
    </div>
  );
}
