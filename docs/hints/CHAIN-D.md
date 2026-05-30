---
target: CHAIN-D
category: SSRF → cloud-metadata → PII exfiltration
steps:
  1:
    tier-1-basic: "URL fetcher. Some endpoint pulls user-supplied URLs without a tight allow-list."
    tier-2-verbose: "A KYC import flow takes a URL and fetches it server-side. The reject list only blocks loopback strings; internal docker-network aliases get through."
  2:
    tier-1-basic: "Internal target. There's a service in the cluster that hands out short-lived credentials."
    tier-2-verbose: "A mock metadata service emits an IAM-style credential payload on a well-known path. The SSRF reaches it through the docker network alias; the credential body lands in the trainee's import response."
  3:
    tier-1-basic: "Storage retrieval. The credentials authenticate against a synthetic document store."
    tier-2-verbose: "A mock S3-style service trusts the metadata credentials and serves a KYC bucket listing under a predictable prefix. The bucket contains synthetic identity documents."
---
