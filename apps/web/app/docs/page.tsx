"use client";

import dynamic from "next/dynamic";
import "swagger-ui-react/swagger-ui.css";

const SwaggerUI = dynamic(() => import("swagger-ui-react"), { ssr: false });

export default function DocsPage() {
  return (
    <div className="py-6">
      <SwaggerUI url="/api/openapi.json" />
    </div>
  );
}
