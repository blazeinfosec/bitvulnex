import { describe, it, expect, beforeEach } from "vitest";
import {
  registerEndpoint,
  buildOpenApiDocument,
} from "./openapi-registry.js";

describe("openapi-registry", () => {
  beforeEach(() => {
    const g = globalThis as { __bvbeOpenApiRegistry?: Map<string, unknown> };
    g.__bvbeOpenApiRegistry = new Map();
  });

  it("registers and surfaces endpoints in the document", () => {
    registerEndpoint({
      method: "get",
      path: "/api/x",
      summary: "x",
      responses: { "200": { description: "ok" } },
    });
    const doc = buildOpenApiDocument() as {
      paths: Record<string, Record<string, { summary: string }>>;
    };
    expect(doc.paths["/api/x"]?.get?.summary).toBe("x");
  });

  it("omitting registerEndpoint hides an endpoint (structural gap)", () => {
    const doc = buildOpenApiDocument() as { paths: Record<string, unknown> };
    expect(Object.keys(doc.paths)).toHaveLength(0);
  });
});
