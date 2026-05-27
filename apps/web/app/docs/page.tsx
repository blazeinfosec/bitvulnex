"use client";

import { useEffect, useRef } from "react";
import SwaggerUIBundle from "swagger-ui-dist/swagger-ui-bundle.js";
import "swagger-ui-dist/swagger-ui.css";

// Use the vanilla swagger-ui-dist bundle rather than swagger-ui-react,
// which has peer-dep limits at React 18 via several transitive deps.

export default function DocsPage() {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    SwaggerUIBundle({
      url: "/api/openapi.json",
      domNode: containerRef.current,
    });
  }, []);

  return <div className="py-6" ref={containerRef} />;
}
