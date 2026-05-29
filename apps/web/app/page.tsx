import Link from "next/link";
import { Container } from "@/components/ui/container";

export default function HomePage() {
  return (
    <>
      <section className="border-b border-border bg-bg">
        <Container className="py-16 sm:py-20 lg:py-24">
          <div className="max-w-3xl">
            <p className="text-xs uppercase tracking-widest text-accent mb-3 font-semibold">
              Institutional spot · margin · OTC
            </p>
            <h1 className="text-3xl sm:text-4xl lg:text-5xl font-semibold tracking-tight text-text mb-4 leading-tight">
              Trade Bitcoin and majors with desk-grade execution.
            </h1>
            <p className="text-base sm:text-lg text-text-dim mb-8 max-w-2xl">
              BVBE is a deliberately vulnerable training exchange. Build attack
              chains, exercise blue-team detection, or just inspect the code.
              Nothing here touches mainnet.
            </p>
            <div className="flex flex-col sm:flex-row gap-3">
              <Link
                href="/signup"
                className="inline-flex items-center justify-center h-11 px-6 text-sm font-semibold rounded-md bg-accent text-accent-fg hover:bg-accent-hover transition-colors no-underline"
              >
                Create lab account
              </Link>
              <Link
                href="/markets"
                className="inline-flex items-center justify-center h-11 px-6 text-sm font-medium text-text border border-border rounded-md hover:bg-bg-hover transition-colors no-underline"
              >
                Browse markets
              </Link>
              <Link
                href="/docs"
                className="inline-flex items-center justify-center h-11 px-6 text-sm font-medium text-text-dim border border-border rounded-md hover:bg-bg-hover hover:text-text transition-colors no-underline"
              >
                Read API docs
              </Link>
            </div>
          </div>
        </Container>
      </section>

      <section className="py-12 sm:py-16 border-b border-border">
        <Container>
          <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
            <div className="rounded-lg border border-border bg-bg-elevated p-5">
              <h3 className="text-base font-semibold text-text mb-2">
                For pentesters
              </h3>
              <p className="text-sm text-text-dim leading-relaxed">
                ~40 planted vulnerabilities across OWASP, PortSwigger, James
                Kettle, and Bitcoin-specific categories. Pyramid difficulty.
              </p>
            </div>
            <div className="rounded-lg border border-border bg-bg-elevated p-5">
              <h3 className="text-base font-semibold text-text mb-2">
                For instructors
              </h3>
              <p className="text-sm text-text-dim leading-relaxed">
                Toggle CTF mode for flags and scoreboard, or run black-box.
                Single-tenant per trainee via Docker Compose.
              </p>
            </div>
            <div className="rounded-lg border border-border bg-bg-elevated p-5 sm:col-span-2 lg:col-span-1">
              <h3 className="text-base font-semibold text-text mb-2">
                For blue teams
              </h3>
              <p className="text-sm text-text-dim leading-relaxed">
                Four documented killer chains map to realistic exchange
                breaches: drain hot wallet, become admin, mass takeover, exfil
                PII.
              </p>
            </div>
          </div>
        </Container>
      </section>
    </>
  );
}
