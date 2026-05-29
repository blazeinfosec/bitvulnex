import Link from "next/link";
import { Container } from "@/components/ui/container";
import { Wordmark } from "@/components/exchange/Wordmark";

export default function NotFound() {
  return (
    <Container className="py-20 sm:py-28">
      <div className="max-w-lg mx-auto text-center">
        <div className="flex justify-center mb-6">
          <Wordmark />
        </div>
        <p className="text-xs uppercase tracking-widest text-text-mute mb-3 font-semibold">
          404 · Not found
        </p>
        <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight text-text mb-3">
          This page slipped through the order book.
        </h1>
        <p className="text-sm sm:text-base text-text-dim mb-8">
          The route you're looking for doesn't exist on this exchange. Check
          the URL or head back to live markets.
        </p>
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <Link
            href="/markets"
            className="inline-flex items-center justify-center h-10 px-5 text-sm font-semibold rounded-md bg-accent text-accent-fg hover:bg-accent-hover transition-colors no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            Back to markets
          </Link>
          <Link
            href="/"
            className="inline-flex items-center justify-center h-10 px-5 text-sm font-medium text-text border border-border rounded-md hover:bg-bg-hover transition-colors no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            Home
          </Link>
        </div>
      </div>
    </Container>
  );
}
