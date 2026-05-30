---
target: CHAIN-B
category: Infra / Auth — request smuggling into mass assignment
steps:
  1:
    tier-1-basic: "Edge framing. The reverse proxy tolerates ambiguous request framing."
    tier-2-verbose: "When a request carries both Content-Length and Transfer-Encoding, the proxy and the upstream may disagree on where one request ends and the next begins. Audit the proxy's framing directives."
  2:
    tier-1-basic: "Upstream parsing. Modern Node rejects framing ambiguity by default — unless told not to."
    tier-2-verbose: "A runtime option on the upstream relaxes the strict HTTP parser. Find the env or command-line flag that turns that strictness off, and confirm both edges and upstream agree."
  3:
    tier-1-basic: "Privilege write. A self-update endpoint accepts more fields than the form ever advertised."
    tier-2-verbose: "Smuggle a self-update request including a role field into a legitimate user's pipelined connection. The mass-assign on the receiving handler persists the change."
---
