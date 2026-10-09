import type { NextConfig } from "next";

// Server-side only: where the FastAPI backend listens. The browser never sees it; it calls the
// same-origin `/api/*`, which Next rewrites here, so the session cookie stays first-party.
const backendUrl = (process.env.BACKEND_URL ?? "http://127.0.0.1:8000").replace(/\/+$/, "");

const nextConfig: NextConfig = {
  // `next build` also emits `.next/standalone` (a minimal `server.js` plus traced dependencies),
  // which the Docker image runs. `next dev` and the tests are unaffected.
  output: "standalone",
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
