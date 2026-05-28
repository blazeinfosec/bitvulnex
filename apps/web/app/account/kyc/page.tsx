"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Container } from "@/components/ui/container";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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

export default function KycPage() {
  const router = useRouter();
  const [state, setState] = useState<KycView | null>(null);
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
      <Container className="py-12">
        <p className="text-navy-700">Loading…</p>
      </Container>
    );
  }

  const status = state.profile?.status ?? "incomplete";

  return (
    <Container className="py-12 max-w-3xl space-y-4">
      <h1 className="text-3xl font-semibold tracking-tight text-navy-900 mb-2">
        Identity verification
      </h1>
      <p className="text-sm text-navy-700">
        Current status: <strong>{status}</strong>
        {state.profile?.rejectionReason && (
          <>
            {" "}
            — <em>{state.profile.rejectionReason}</em>
          </>
        )}
      </p>

      <Card>
        <CardHeader>
          <CardTitle>1 — Profile</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={saveProfile} className="grid sm:grid-cols-2 gap-3 text-sm">
            <input
              required
              placeholder="legal name"
              value={legalName}
              onChange={(e) => setLegalName(e.target.value)}
              className="border border-navy-200 rounded-md h-10 px-3"
            />
            <input
              required
              type="date"
              value={dateOfBirth}
              onChange={(e) => setDateOfBirth(e.target.value)}
              className="border border-navy-200 rounded-md h-10 px-3"
            />
            <input
              required
              maxLength={2}
              placeholder="country (2-letter)"
              value={country}
              onChange={(e) => setCountry(e.target.value.toUpperCase())}
              className="border border-navy-200 rounded-md h-10 px-3"
            />
            <input
              required
              placeholder="city"
              value={city}
              onChange={(e) => setCity(e.target.value)}
              className="border border-navy-200 rounded-md h-10 px-3"
            />
            <input
              required
              placeholder="address line"
              value={addressLine}
              onChange={(e) => setAddressLine(e.target.value)}
              className="border border-navy-200 rounded-md h-10 px-3 sm:col-span-2"
            />
            <input
              required
              placeholder="postal code"
              value={postalCode}
              onChange={(e) => setPostalCode(e.target.value)}
              className="border border-navy-200 rounded-md h-10 px-3"
            />
            <div className="sm:col-span-2">
              <Button type="submit">Save profile</Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>2 — Documents</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div className="flex items-center gap-3">
            <select
              value={docType}
              onChange={(e) => setDocType(e.target.value)}
              className="border border-navy-200 rounded-md h-10 px-3"
            >
              <option value="passport">Passport</option>
              <option value="id_card">ID card</option>
              <option value="address_proof">Address proof</option>
            </select>
            <input type="file" onChange={uploadDoc} />
          </div>
          <details className="text-navy-700">
            <summary className="cursor-pointer">
              Import from a cloud-storage URL instead
            </summary>
            <form
              onSubmit={importFromUrl}
              className="flex items-center gap-2 mt-3"
            >
              <select
                value={importType}
                onChange={(e) => setImportType(e.target.value)}
                className="border border-navy-200 rounded-md h-10 px-3"
              >
                <option value="address_proof">Address proof</option>
                <option value="passport">Passport</option>
                <option value="id_card">ID card</option>
              </select>
              <input
                required
                placeholder="https://..."
                value={importUrl}
                onChange={(e) => setImportUrl(e.target.value)}
                className="flex-1 border border-navy-200 rounded-md h-10 px-3 font-mono"
              />
              <Button type="submit" variant="secondary">
                Import
              </Button>
            </form>
          </details>

          {state.documents.length > 0 && (
            <table className="w-full mt-3">
              <thead className="text-left text-navy-500 text-xs uppercase">
                <tr>
                  <th className="py-1">Type</th>
                  <th>Filename</th>
                  <th>Source</th>
                  <th>Size</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {state.documents.map((d) => (
                  <tr key={d.id} className="border-t border-navy-200">
                    <td className="py-2">{d.type}</td>
                    <td className="font-mono">{d.filename}</td>
                    <td>{d.source}</td>
                    <td className="font-tabular">{d.size}</td>
                    <td>
                      <Link
                        href={`/api/v2/me/kyc/doc?file=${encodeURIComponent(
                          d.storedPath,
                        )}`}
                      >
                        view
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>3 — Submit for review</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {status === "incomplete" || status === "rejected" ? (
            <Button onClick={submitForReview}>Submit</Button>
          ) : (
            <p className="text-navy-700">
              Your submission is {status}.{" "}
              {status === "pending" &&
                "A reviewer will get to it within 24h on a normal lab day."}
            </p>
          )}
        </CardContent>
      </Card>

      {message && <p className="text-sm text-navy-700">{message}</p>}
    </Container>
  );
}
