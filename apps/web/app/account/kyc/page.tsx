"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Container } from "@/components/ui/container";
import { authedFetch, getAccessToken } from "@/lib/token-storage";

type DocSummary = {
  id: string;
  type: string;
  filename: string;
  storedPath: string;
  mimeType: string;
  size: number;
  source: string;
  createdAt: string;
};

type KycView = {
  profile: {
    legalName: string | null;
    dateOfBirth: string | null;
    country: string | null;
    addressLine: string | null;
    city: string | null;
    postalCode: string | null;
    status: string;
    rejectionReason: string | null;
  } | null;
  documents: DocSummary[];
};

const inputClass =
  "w-full h-10 px-3 rounded-md bg-bg border border-border text-text placeholder:text-text-mute focus:outline-none focus:ring-2 focus:ring-accent focus:border-accent transition-colors";

const primaryBtn =
  "inline-flex items-center justify-center h-10 px-4 rounded-md bg-accent text-accent-fg hover:bg-accent-hover transition-colors font-semibold text-sm";
const secondaryBtn =
  "inline-flex items-center justify-center h-9 px-3 rounded-md bg-bg border border-border text-text hover:bg-bg-hover transition-colors text-sm";

type Step = 1 | 2 | 3 | 4;

export default function KycPage() {
  const router = useRouter();
  const [state, setState] = useState<KycView | null>(null);
  const [step, setStep] = useState<Step>(1);

  const [legalName, setLegalName] = useState("");
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [country, setCountry] = useState("");
  const [addressLine, setAddressLine] = useState("");
  const [city, setCity] = useState("");
  const [postalCode, setPostalCode] = useState("");
  const [docType, setDocType] = useState("passport");
  const [importUrl, setImportUrl] = useState("");
  const [importType, setImportType] = useState("address_proof");
  const [message, setMessage] = useState<string | null>(null);

  async function load() {
    const res = await authedFetch("/api/v2/me/kyc");
    if (res.status === 401) {
      router.replace("/login");
      return;
    }
    const body = (await res.json()) as KycView;
    setState(body);
    if (body.profile) {
      setLegalName(body.profile.legalName ?? "");
      setDateOfBirth(
        body.profile.dateOfBirth
          ? new Date(body.profile.dateOfBirth).toISOString().slice(0, 10)
          : "",
      );
      setCountry(body.profile.country ?? "");
      setAddressLine(body.profile.addressLine ?? "");
      setCity(body.profile.city ?? "");
      setPostalCode(body.profile.postalCode ?? "");
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function saveProfile(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    const res = await authedFetch("/api/v2/me/kyc/profile", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        legalName,
        dateOfBirth,
        country,
        addressLine,
        city,
        postalCode,
      }),
    });
    if (!res.ok) {
      setMessage("Save failed.");
      return;
    }
    setMessage("Profile saved.");
    await load();
    setStep(2);
  }

  async function uploadDoc(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    const fd = new FormData();
    fd.append("file", f);
    fd.append("type", docType);
    const access = getAccessToken();
    const res = await fetch("/api/v2/me/kyc/documents", {
      method: "POST",
      headers: access ? { authorization: `Bearer ${access}` } : {},
      body: fd,
    });
    setMessage(res.ok ? "Uploaded." : "Upload failed.");
    await load();
    e.target.value = "";
  }

  async function importFromUrl(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    const res = await authedFetch("/api/v2/me/kyc/import-url", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: importUrl, type: importType }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as {
        error?: { message?: string };
      };
      setMessage(body.error?.message ?? "Import failed.");
      return;
    }
    setMessage("Imported.");
    setImportUrl("");
    await load();
  }

  async function submitForReview() {
    setMessage(null);
    const res = await authedFetch("/api/v2/me/kyc/submit", { method: "POST" });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as {
        error?: { message?: string };
      };
      setMessage(body.error?.message ?? "Submit failed.");
      return;
    }
    setMessage("Submitted for review.");
    await load();
  }

  if (!state) {
    return (
      <Container className="py-10">
        <p className="text-text-dim">Loading…</p>
      </Container>
    );
  }

  const status = state.profile?.status ?? "incomplete";

  const hasProfile = Boolean(state.profile?.legalName);
  const idDocs = state.documents.filter(
    (d) => d.type === "passport" || d.type === "id_card",
  );
  const addrDocs = state.documents.filter((d) => d.type === "address_proof");
  const hasId = idDocs.length > 0;
  const hasAddress = addrDocs.length > 0;

  const totalSteps = 4;
  const completed = [hasProfile, hasId, hasAddress, status !== "incomplete"].filter(
    Boolean,
  ).length;
  const progressPct = Math.round((completed / totalSteps) * 100);

  const stepLabels: { n: Step; label: string; done: boolean }[] = [
    { n: 1, label: "Personal info", done: hasProfile },
    { n: 2, label: "ID upload", done: hasId },
    { n: 3, label: "Address proof", done: hasAddress },
    { n: 4, label: "Review", done: status !== "incomplete" },
  ];

  return (
    <Container className="py-10 max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-text">
          Identity verification
        </h1>
        <p className="text-sm text-text-dim mt-1">
          Verify your identity to unlock higher tiers, increased limits, and
          features like the OTC desk.
        </p>
      </div>

      {/* Progress bar */}
      <div className="rounded-lg border border-border bg-bg-elevated p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-xs uppercase tracking-wider text-text-mute font-medium">
              Tier progress
            </div>
            <div className="text-sm text-text mt-0.5">
              {completed} of {totalSteps} steps complete
            </div>
          </div>
          <div className="text-right">
            <div className="text-xs uppercase tracking-wider text-text-mute font-medium">
              Status
            </div>
            <div
              className={
                status === "approved"
                  ? "text-buy text-sm font-semibold mt-0.5"
                  : status === "rejected"
                    ? "text-sell text-sm font-semibold mt-0.5"
                    : status === "pending"
                      ? "text-warn text-sm font-semibold mt-0.5"
                      : "text-text-dim text-sm font-semibold mt-0.5"
              }
            >
              {status}
            </div>
          </div>
        </div>
        <div className="h-1.5 w-full rounded-full bg-bg overflow-hidden">
          <div
            className="h-full bg-accent transition-all"
            style={{ width: `${progressPct}%` }}
          />
        </div>
        {state.profile?.rejectionReason && (
          <p className="text-xs text-sell">
            Rejection reason: {state.profile.rejectionReason}
          </p>
        )}
      </div>

      {/* Stepper */}
      <nav className="flex gap-1 border-b border-border overflow-x-auto">
        {stepLabels.map((s) => (
          <button
            key={s.n}
            type="button"
            onClick={() => setStep(s.n)}
            className={
              step === s.n
                ? "px-4 py-2 text-sm font-medium text-text border-b-2 border-accent -mb-px whitespace-nowrap"
                : "px-4 py-2 text-sm font-medium text-text-dim hover:text-text border-b-2 border-transparent hover:border-border -mb-px whitespace-nowrap"
            }
          >
            <span
              className={
                "inline-block w-5 h-5 rounded-full text-xs leading-5 text-center mr-2 font-mono " +
                (s.done
                  ? "bg-buy/20 text-buy"
                  : step === s.n
                    ? "bg-accent text-accent-fg"
                    : "bg-bg border border-border text-text-mute")
              }
            >
              {s.done ? "✓" : s.n}
            </span>
            {s.label}
          </button>
        ))}
      </nav>

      {message && (
        <div className="rounded-md border border-border bg-bg-elevated text-text-dim px-3 py-2 text-sm">
          {message}
        </div>
      )}

      {step === 1 && (
        <section className="rounded-lg border border-border bg-bg-elevated p-6">
          <h2 className="text-sm font-semibold text-text mb-4">
            1 — Personal info
          </h2>
          <form onSubmit={saveProfile} className="grid sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs uppercase tracking-wider text-text-mute mb-1 font-medium">
                Legal name
              </label>
              <input
                required
                value={legalName}
                onChange={(e) => setLegalName(e.target.value)}
                className={inputClass}
              />
            </div>
            <div>
              <label className="block text-xs uppercase tracking-wider text-text-mute mb-1 font-medium">
                Date of birth
              </label>
              <input
                required
                type="date"
                value={dateOfBirth}
                onChange={(e) => setDateOfBirth(e.target.value)}
                className={inputClass}
              />
            </div>
            <div>
              <label className="block text-xs uppercase tracking-wider text-text-mute mb-1 font-medium">
                Country (ISO-2)
              </label>
              <input
                required
                maxLength={2}
                value={country}
                onChange={(e) => setCountry(e.target.value.toUpperCase())}
                className={inputClass + " font-mono"}
              />
            </div>
            <div>
              <label className="block text-xs uppercase tracking-wider text-text-mute mb-1 font-medium">
                City
              </label>
              <input
                required
                value={city}
                onChange={(e) => setCity(e.target.value)}
                className={inputClass}
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs uppercase tracking-wider text-text-mute mb-1 font-medium">
                Address line
              </label>
              <input
                required
                value={addressLine}
                onChange={(e) => setAddressLine(e.target.value)}
                className={inputClass}
              />
            </div>
            <div>
              <label className="block text-xs uppercase tracking-wider text-text-mute mb-1 font-medium">
                Postal code
              </label>
              <input
                required
                value={postalCode}
                onChange={(e) => setPostalCode(e.target.value)}
                className={inputClass + " font-mono"}
              />
            </div>
            <div className="sm:col-span-2 flex justify-end pt-2">
              <button type="submit" className={primaryBtn}>
                Save & continue →
              </button>
            </div>
          </form>
        </section>
      )}

      {step === 2 && (
        <section className="rounded-lg border border-border bg-bg-elevated p-6 space-y-4">
          <h2 className="text-sm font-semibold text-text">2 — ID upload</h2>
          <p className="text-xs text-text-dim">
            Upload a clear, color image or PDF of a passport or government ID.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <select
              value={docType}
              onChange={(e) => setDocType(e.target.value)}
              className={inputClass + " w-auto"}
            >
              <option value="passport">Passport</option>
              <option value="id_card">ID card</option>
            </select>
            <label className={secondaryBtn + " cursor-pointer"}>
              Choose file
              <input
                type="file"
                onChange={uploadDoc}
                className="hidden"
                accept="image/*,application/pdf"
              />
            </label>
          </div>
          {idDocs.length > 0 && (
            <ul className="space-y-1 text-sm">
              {idDocs.map((d) => (
                <li
                  key={d.id}
                  className="flex items-center justify-between border-b border-border-subtle py-2"
                >
                  <span className="text-text-dim">
                    <span className="font-mono">{d.filename}</span> · {d.size}B
                  </span>
                  <Link
                    href={`/api/v2/me/kyc/doc?file=${encodeURIComponent(d.storedPath)}`}
                    className="text-accent text-xs"
                  >
                    view
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <div className="flex justify-end pt-2">
            <button
              type="button"
              className={primaryBtn}
              onClick={() => setStep(3)}
              disabled={!hasId}
            >
              Continue →
            </button>
          </div>
        </section>
      )}

      {step === 3 && (
        <section className="rounded-lg border border-border bg-bg-elevated p-6 space-y-4">
          <h2 className="text-sm font-semibold text-text">
            3 — Address proof
          </h2>
          <p className="text-xs text-text-dim">
            Utility bill, bank statement, or government letter dated within the
            past 90 days.
          </p>
          <label className={secondaryBtn + " cursor-pointer w-fit"}>
            Choose file
            <input
              type="file"
              onChange={(e) => {
                setDocType("address_proof");
                uploadDoc(e);
              }}
              className="hidden"
              accept="image/*,application/pdf"
            />
          </label>
          {addrDocs.length > 0 && (
            <ul className="space-y-1 text-sm">
              {addrDocs.map((d) => (
                <li
                  key={d.id}
                  className="flex items-center justify-between border-b border-border-subtle py-2"
                >
                  <span className="text-text-dim">
                    <span className="font-mono">{d.filename}</span> · {d.size}B
                  </span>
                  <Link
                    href={`/api/v2/me/kyc/doc?file=${encodeURIComponent(d.storedPath)}`}
                    className="text-accent text-xs"
                  >
                    view
                  </Link>
                </li>
              ))}
            </ul>
          )}

          {/* Advanced: URL import */}
          <details className="text-sm border-t border-border-subtle pt-3">
            <summary className="cursor-pointer text-text-dim hover:text-text text-xs uppercase tracking-wider font-medium">
              Advanced: import from a cloud-storage URL
            </summary>
            <form
              onSubmit={importFromUrl}
              className="flex flex-col sm:flex-row items-stretch gap-2 mt-3"
            >
              <select
                value={importType}
                onChange={(e) => setImportType(e.target.value)}
                className={inputClass + " sm:w-auto"}
              >
                <option value="address_proof">Address proof</option>
                <option value="passport">Passport</option>
                <option value="id_card">ID card</option>
              </select>
              <input
                required
                placeholder="https://…"
                value={importUrl}
                onChange={(e) => setImportUrl(e.target.value)}
                className={inputClass + " flex-1"}
              />
              <button type="submit" className={secondaryBtn}>
                Import
              </button>
            </form>
          </details>

          <div className="flex justify-end pt-2">
            <button
              type="button"
              className={primaryBtn}
              onClick={() => setStep(4)}
              disabled={!hasAddress}
            >
              Continue →
            </button>
          </div>
        </section>
      )}

      {step === 4 && (
        <section className="rounded-lg border border-border bg-bg-elevated p-6 space-y-4">
          <h2 className="text-sm font-semibold text-text">4 — Review</h2>
          <dl className="grid sm:grid-cols-2 gap-3 text-sm">
            <div>
              <dt className="text-xs uppercase tracking-wider text-text-mute font-medium">
                Legal name
              </dt>
              <dd className="text-text">{legalName || "—"}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wider text-text-mute font-medium">
                Country
              </dt>
              <dd className="text-text font-mono">{country || "—"}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wider text-text-mute font-medium">
                ID document
              </dt>
              <dd className="text-text">{idDocs.length} uploaded</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wider text-text-mute font-medium">
                Address proof
              </dt>
              <dd className="text-text">{addrDocs.length} uploaded</dd>
            </div>
          </dl>

          {(status === "incomplete" || status === "rejected") && (
            <button
              type="button"
              className={primaryBtn + " w-full"}
              onClick={submitForReview}
            >
              Submit for review
            </button>
          )}
          {status === "pending" && (
            <div className="rounded-md border border-warn/40 bg-warn/10 text-warn px-3 py-2 text-sm">
              Your submission is pending. A reviewer typically responds within
              24h on a normal lab day.
            </div>
          )}
          {status === "approved" && (
            <div className="rounded-md border border-buy/40 bg-buy/10 text-buy px-3 py-2 text-sm">
              Verification complete. Higher tiers unlocked.
            </div>
          )}
        </section>
      )}
    </Container>
  );
}
