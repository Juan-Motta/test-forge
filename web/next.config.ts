import type { NextConfig } from "next";

// Server-side only: where the FastAPI backend listens. The browser never sees it; it calls the
// same-origin `/api/*`, which Next rewrites here, so the session cookie stays first-party.
const backendUrl = (process.env.BACKEND_URL ?? "http://127.0.0.1:8000").replace(/\/+$/, "");

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${backendUrl}/api/:path*` }];
  },
};

export default nextConfig;
