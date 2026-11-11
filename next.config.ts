import type { NextConfig } from "next";

// Content-Security-Policy is set per request (with a nonce) in src/proxy.ts.
const securityHeaders = (embed = false) => [
  ...(embed ? [] : [{ key: "X-Frame-Options", value: "DENY" }]),
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "same-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  serverExternalPackages: ["exceljs"],
  experimental: {
    // import wizard uploads Excel files up to 5 MB
    serverActions: { bodySizeLimit: "6mb" },
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async headers() {
    return [
      { source: "/((?!embed/).*)", headers: securityHeaders() },
      { source: "/embed/:path*", headers: securityHeaders(true) },
      // landing-page images and fonts: cache in the browser and at the edge
      { source: "/join/:file(.*\\.(?:webp|woff2))", headers: [{ key: "Cache-Control", value: "public, max-age=604800, stale-while-revalidate=86400" }] },
    ];
  },
};

export default nextConfig;
