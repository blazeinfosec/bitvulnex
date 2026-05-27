import { Container } from "./container";

export function Footer() {
  return (
    <footer className="border-t border-navy-200 bg-navy-50/60 text-sm text-navy-700">
      <Container className="py-8 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <span className="font-medium text-navy-900">BVBE</span> · Authorized
          security education lab · Apache 2.0
        </div>
        <div className="flex gap-4">
          <a href="/about/changelog">Changelog</a>
          <a href="/docs">API</a>
          <a
            href="https://www.blazeinfosec.com/"
            target="_blank"
            rel="noopener noreferrer"
          >
            Blaze Information Security
          </a>
        </div>
      </Container>
    </footer>
  );
}
