import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // ADR-4: every screen is per-user and permission-dependent; revoked access
  // must apply on the next request, so Cache Components stays off.
  cacheComponents: false,
  poweredByHeader: false,
  serverExternalPackages: ["@node-rs/argon2"],
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
