// Per architect Issue 2: the OpenAPI document is built from this
// registry rather than hand-written. Endpoints register themselves on
// module load (via a side-effect import in app/api/openapi.json/route.ts).
// Endpoints that should NOT appear in public docs simply do not call
// registerEndpoint() — making the "intentionally incomplete docs"
// gap structural rather than manually maintained.
//
// The registry is anchored to globalThis (same pattern as the Prisma
// client in @bvbe/db) so that Next.js route-segment bundles and HMR
// reloads in dev share a single Map instance. Without this, each
// compiled route segment could end up with its own copy and the doc
// would surface only whichever segment was last loaded.

type Method = "get" | "post" | "put" | "patch" | "delete";

export type EndpointSpec = {
  method: Method;
  path: string;
  summary: string;
  responses: Record<string, { description: string }>;
};

declare global {
  // eslint-disable-next-line no-var
  var __bvbeOpenApiRegistry: Map<string, EndpointSpec> | undefined;
}

function registry(): Map<string, EndpointSpec> {
  return (globalThis.__bvbeOpenApiRegistry ??= new Map<string, EndpointSpec>());
}

function key(spec: EndpointSpec): string {
  return `${spec.method.toUpperCase()} ${spec.path}`;
}

export function registerEndpoint(spec: EndpointSpec): void {
  registry().set(key(spec), spec);
}

export function buildOpenApiDocument(): unknown {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const spec of registry().values()) {
    const pathEntry = (paths[spec.path] ??= {});
    pathEntry[spec.method] = {
      summary: spec.summary,
      responses: spec.responses,
    };
  }
  return {
    openapi: "3.1.0",
    info: {
      title: "Bitvulnex — Public API",
      version: "0.0.0-phase0",
      description:
        "Public API for Bitvulnex, a deliberately vulnerable Bitcoin exchange. " +
        "DO NOT DEPLOY. Authorized security education only.",
    },
    paths,
  };
}
