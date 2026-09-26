// Mock S3 endpoint for CHAIN D — synthetic KYC bucket.
// Lives on the internal docker network under the alias
// `s3.bvbe.internal`. A successful SSRF that has already minted
// IAM credentials from mock-imds presents them here, but this mock
// is permissive — it serves anyone on the network for lab realism.
//
// All KYC payloads are synthetic — no real PII.

import express from "express";

const app = express();

const KEYS = [
  "kyc/user-001/passport-front.pdf",
  "kyc/user-001/passport-back.pdf",
  "kyc/user-001/selfie.jpg",
  "kyc/user-042/drivers-license-front.pdf",
  "kyc/user-042/proof-of-address.pdf",
  "kyc/user-117/national-id.pdf",
  "kyc/user-117/selfie.jpg",
];

const SYNTHETIC_DOC = {
  legalName: "Synthetic Subject (LAB)",
  dateOfBirth: "1985-04-12",
  documentType: "passport",
  documentNumber: "LAB-SYNTH-0000-0001",
  countryOfIssue: "ZZ",
  issuedAt: "2020-01-01",
  expiresAt: "2030-01-01",
  notes:
    "This is synthetic lab data generated for the Bitvulnex security education " +
    "lab. No real personally identifying information is present. Do not " +
    "deploy this lab anywhere a real reviewer could mistake it for live " +
    "data.",
};

function listingXml(): string {
  const contents = KEYS.map(
    (k) =>
      `  <Contents>\n` +
      `    <Key>${k}</Key>\n` +
      `    <LastModified>2026-05-01T12:00:00.000Z</LastModified>\n` +
      `    <Size>4096</Size>\n` +
      `    <StorageClass>STANDARD</StorageClass>\n` +
      `  </Contents>`,
  ).join("\n");
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">\n` +
    `  <Name>kyc-bucket</Name>\n` +
    `  <Prefix></Prefix>\n` +
    `  <MaxKeys>1000</MaxKeys>\n` +
    `  <IsTruncated>false</IsTruncated>\n` +
    contents +
    `\n</ListBucketResult>\n`
  );
}

app.get("/kyc-bucket/", (_req, res) => {
  res.type("application/xml").send(listingXml());
});

app.get("/kyc-bucket", (_req, res) => {
  res.type("application/xml").send(listingXml());
});

function sendObject(res: express.Response, key: string): void {
  res.json({
    bucket: "kyc-bucket",
    key,
    record: SYNTHETIC_DOC,
  });
}

// Short form: /kyc-bucket/<user>/<doc> (the `kyc/` prefix is implied).
app.get("/kyc-bucket/:userKey/:docKey", (req, res) => {
  const { userKey, docKey } = req.params;
  sendObject(res, `kyc/${userKey}/${docKey}`);
});

// Full-key form, exactly as returned by the listing:
// /kyc-bucket/kyc/<user>/<doc>
app.get(/^\/kyc-bucket\/(kyc\/.+)$/, (req, res) => {
  const key = (req.params as unknown as Record<string, string>)[0] ?? "";
  sendObject(res, key);
});

app.get("/", (_req, res) => {
  res.type("text/plain").send("mock-s3\n");
});

const port = Number(process.env.PORT ?? 80);
app.listen(port, () => {
  console.log(`[mock-s3] listening on :${port}`);
});
