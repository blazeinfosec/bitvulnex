"use client";

import { useEffect } from "react";
import Link from "next/link";
import { Container } from "@/components/ui/container";
import { Wordmark } from "@/components/exchange/Wordmark";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Surface to the dev console so trainees can inspect.
    if (typeof console !== "undefined") {
      console.error("[bvbe] route error:", error);
    }
  }, [error]);

  return (
    <Container className="py-20 sm:py-28">
      <div className="max-w-lg mx-auto text-center">
        <div className="flex justify-center mb-6">
          <Wordmark />
        </div>
        <p className="text-xs uppercase tracking-widest text-sell mb-3 font-semibold">
          Something went wrong
        </p>
        <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight text-text mb-3">
          We hit an unhandled error rendering this page.
        </h1>
        <p className="text-sm sm:text-base text-text-dim mb-4">
          The lab is fine — this is just one view crashing. Try again, or
          return to markets.
        </p>
        {error.message ? (
          <pre
            role="alert"
            className="text-left text-xs font-mono bg-bg-elevated border border-border rounded-md p-3 mb-6 text-text-dim overflow-x-auto"
          >
            {error.message}
            {error.digest ? `\ndigest: ${error.digest}` : ""}
          </pre>
        ) : null}
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <button
            type="button"
            onClick={reset}
            className="inline-flex items-center justify-center h-10 px-5 text-sm font-semibold rounded-md bg-accent text-accent-fg hover:bg-accent-hover transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            Try again
          </button>
          <Link
            href="/markets"
            className="inline-flex items-center justify-center h-10 px-5 text-sm font-medium text-text border border-border rounded-md hover:bg-bg-hover transition-colors no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            Back to markets
          </Link>
        </div>
      </div>
    </Container>
  );
}
