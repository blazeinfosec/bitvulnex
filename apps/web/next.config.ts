import type { NextConfig } from "next";

const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  transpilePackages: [
    "@bvbe/shared",
    "@bvbe/db",
    "@bvbe/bitcoin-rpc-types",
  ],
  experimental: {
    typedRoutes: true,
  },
};

export default config;
