// Per architect Issue 2: the OpenAPI document is built from this
// registry rather than hand-written. Endpoints register themselves on
// module load (via a side-effect import in app/api/openapi.json/route.ts).
// Endpoints that should NOT appear in public docs simply do not call
// registerEndpoint() — making the "intentionally incomplete docs"
// gap structural rather than manually maintained.

type Method = "get" | "post" | "put" | "patch" | "delete";

export type EndpointSpec = {
  method: Method;
  path: string;
  summary: string;
  responses: Record<string, { description: string }>;
};

const registry = new Map<string, EndpointSpec>();

function key(spec: EndpointSpec): string {
  return `${spec.method.toUpperCase()} ${spec.path}`;
}

export function registerEndpoint(spec: EndpointSpec): void {
  registry.set(key(spec), spec);
}

export function buildOpenApiDocument(): unknown {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const spec of registry.values()) {
    paths[spec.path] ??= {};
    paths[spec.path][spec.method] = {
      summary: spec.summary,
      responses: spec.responses,
    };
  }
  return {
    openapi: "3.1.0",
    info: {
      title: "BVBE — Public API",
      version: "0.0.0-phase0",
      description:
        "Public API for the Blaze Vulnerable Bitcoin Exchange. " +
        "DO NOT DEPLOY. Authorized security education only.",
    },
    paths,
  };
}

