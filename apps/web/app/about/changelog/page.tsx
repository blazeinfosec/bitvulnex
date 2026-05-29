import { Container } from "@/components/ui/container";
import { readFileSync } from "node:fs";
import { join } from "node:path";

export const dynamic = "force-static";

function loadChangelog(): string {
  // Read the repo-root CHANGELOG.md at build/render time. The file is
  // copied into the container so this path resolves at runtime.
  const candidates = [
    join(process.cwd(), "..", "..", "CHANGELOG.md"),
    join(process.cwd(), "CHANGELOG.md"),
  ];
  for (const p of candidates) {
    try {
      return readFileSync(p, "utf8");
    } catch {
      // try next
    }
  }
  return "# Changelog\n\n(Unable to load CHANGELOG.md — Phase 0 placeholder.)";
}

export default function ChangelogPage() {
  const raw = loadChangelog();
  return (
    <Container className="py-12">
      <h1 className="text-3xl font-semibold tracking-tight text-text mb-2">
        Changelog
      </h1>
      <p className="text-sm text-text-dim mb-8">
        Mirror of <code>CHANGELOG.md</code> in the repository. Some entries in
        later phases may reference fixed bugs that have adjacent unfixed
        siblings — read carefully.
      </p>
      <pre className="whitespace-pre-wrap font-mono text-sm bg-bg-elevated border border-border rounded-md p-5 text-text">
        {raw}
      </pre>
    </Container>
  );
}
