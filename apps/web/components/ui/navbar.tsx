import Link from "next/link";
import { Container } from "./container";
import { Button } from "./button";

export function NavBar() {
  return (
    <header className="border-b border-navy-200 bg-white">
      <Container className="flex items-center justify-between h-16">
        <Link href="/" className="flex items-center gap-2 no-underline">
          <span className="font-semibold text-navy-900 tracking-tight">
            BVBE
          </span>
          <span className="text-xs uppercase tracking-wider text-navy-500">
            Exchange · Lab
          </span>
        </Link>
        <nav className="flex items-center gap-1">
          <Button variant="ghost" size="sm" asChild>
            <Link href="/about/changelog">Changelog</Link>
          </Button>
          <Button variant="ghost" size="sm" asChild>
            <Link href="/docs">API Docs</Link>
          </Button>
          <Button variant="secondary" size="sm" asChild>
            <Link href="/login">Sign in</Link>
          </Button>
          <Button variant="primary" size="sm" asChild>
            <Link href="/signup">Create account</Link>
          </Button>
        </nav>
      </Container>
    </header>
  );
}
