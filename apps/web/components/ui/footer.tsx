import { Container } from "./container";

export function Footer() {
  return (
    <footer className="border-t border-border bg-bg-elevated text-sm text-text-dim">
      <Container className="py-8 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <span className="font-semibold text-text">BVBE</span> · Authorized
          security education lab · Apache 2.0
        </div>
        <div className="flex gap-4">
          <a href="/about/changelog" className="hover:text-accent">
            Changelog
          </a>
          <a href="/docs" className="hover:text-accent">
            API
          </a>
          <a
            href="https://www.blazeinfosec.com/"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-accent"
          >
            Blaze Information Security
          </a>
        </div>
      </Container>
    </footer>
  );
}
