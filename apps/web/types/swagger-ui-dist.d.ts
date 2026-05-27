declare module "swagger-ui-dist/swagger-ui-bundle.js" {
  type SwaggerUIBundleOptions = {
    url?: string;
    spec?: object;
    domNode?: HTMLElement | null;
    dom_id?: string;
    presets?: unknown[];
    plugins?: unknown[];
    layout?: string;
    deepLinking?: boolean;
  };
  const SwaggerUIBundle: (options: SwaggerUIBundleOptions) => unknown;
  export default SwaggerUIBundle;
}
