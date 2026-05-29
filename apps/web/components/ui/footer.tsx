import Link from "next/link";
import { Container } from "./container";

export function Footer() {
  return (
    <footer className="border-t border-border bg-bg-elevated text-sm text-text-dim">
      <Container className="py-8 flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-2">
          <div>
            <span className="font-semibold text-text">BVBE</span> · Authorized
            security education lab · Apache 2.0
          </div>
          <p className="text-xs text-text-mute max-w-md">
            Blaze Vulnerable Bitcoin Exchange. Deliberately vulnerable for
            training. Do not deploy. Never use real funds.
          </p>
        </div>
        <div className="flex flex-col gap-2 text-xs">
          <div className="text-text-mute uppercase tracking-wider font-medium">
            Resources
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            <Link href="/docs" className="hover:text-accent no-underline">
              API docs
            </Link>
            <Link href="/status" className="hover:text-accent no-underline">
              Status
            </Link>
            <Link href="/bug-bounty" className="hover:text-accent no-underline">
              Bug bounty
            </Link>
            <a
              href="https://www.blazeinfosec.com/"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-accent no-underline"
            >
              Blaze Information Security
            </a>
          </div>
        </div>
      </Container>
    </footer>
  );
}
