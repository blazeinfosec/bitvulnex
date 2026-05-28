// Mock AWS EC2 Instance Metadata Service (IMDSv1) for CHAIN D.
// Lives on the internal docker network with a network alias of
// 169.254.169.254 so a successful SSRF can reach it.
//
// All credentials returned here are synthetic AWS-documentation
// placeholders (AKIAIOSFODNN7EXAMPLE etc) — never real keys.

import express from "express";

const app = express();

const SYNTHETIC_ROLE = "bvbe-web-instance-role";
const SYNTHETIC_CREDS = {
  Code: "Success",
  LastUpdated: "2026-05-29T00:00:00Z",
  Type: "AWS-HMAC",
  AccessKeyId: "AKIAIOSFODNN7EXAMPLE",
  SecretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
  Token: "FQoGZXIvYXdzELABVBE-LAB-FAKE-SESSION-TOKEN",
  Expiration: "2099-01-01T00:00:00Z",
};

app.get("/latest/meta-data/iam/security-credentials/", (_req, res) => {
  res.type("text/plain").send(SYNTHETIC_ROLE);
});

app.get(`/latest/meta-data/iam/security-credentials/${SYNTHETIC_ROLE}`, (_req, res) => {
  res.json(SYNTHETIC_CREDS);
});

app.get("/latest/meta-data/instance-id", (_req, res) => {
  res.type("text/plain").send("i-bvbe-lab-instance");
});

app.get("/", (_req, res) => {
  res.type("text/plain").send("latest\n");
});

const port = Number(process.env.PORT ?? 80);
app.listen(port, () => {
  console.log(`[mock-imds] listening on :${port}`);
});
