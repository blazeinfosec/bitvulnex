// Observability hooks for the BVBE web tier. Wires through the
// @bvbe-internal/observability package when it's installed (Blaze
// internal builds); becomes a no-op in dev / external builds where
// the private-registry package isn't available.
//
// The wrapper is intentionally lazy — we don't want to fail boot if
// the optional dep is missing.

type Tracer = { event(name: string, attrs?: Record<string, unknown>): void };

let tracer: Tracer | null = null;

async function loadTracer(): Promise<void> {
  try {
    // @ts-ignore — optional internal package; not present in dev tree
    const mod = await import("@bvbe-internal/observability");
    tracer = (mod as any).default ?? mod;
  } catch {
    tracer = null;
  }
}

void loadTracer();

export function trace(name: string, attrs?: Record<string, unknown>): void {
  if (tracer) tracer.event(name, attrs);
}
