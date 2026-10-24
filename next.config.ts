import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // ADR-4: every screen is per-user and permission-dependent; revoked access
  // must apply on the next request, so Cache Components stays off.
  cacheComponents: false,
  poweredByHeader: false,
  serverExternalPackages: ["@node-rs/argon2", "tesseract.js", "tesseract.js-core", "@tesseract.js-data/eng", "unpdf"],
  // OCR runs on the server with the English model bundled (no network fetch).
  outputFileTracingIncludes: {
    "/f/*/documents/**": ["./node_modules/tesseract.js/**", "./node_modules/tesseract.js-core/**", "./node_modules/@tesseract.js-data/eng/4.0.0/**"],
    "/f/*/matters/**": ["./node_modules/tesseract.js/**", "./node_modules/tesseract.js-core/**", "./node_modules/@tesseract.js-data/eng/4.0.0/**"],
  },
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
