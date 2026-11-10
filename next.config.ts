import type { NextConfig } from "next";

// `npm run build:app` sets BUILD_TARGET=app: the site is exported as static files
// into /out, which Capacitor packs into the Android app.
const isAppBuild = process.env.BUILD_TARGET === "app";

const nextConfig: NextConfig = {
  ...(isAppBuild ? { output: "export" as const } : {}),
  /* config options here */
  experimental: {
    agentFeedback: true,
  },
  // Not supported by static export, so only on for the website build
  cacheComponents: !isAppBuild,
  partialPrefetching: !isAppBuild,
  // Website only: the service worker must never be cached, so updates reach users.
  // (Static exports for the app don't support headers.)
  ...(isAppBuild
    ? {}
    : {
        async headers() {
          return [
            {
              source: "/sw.js",
              headers: [
                { key: "Content-Type", value: "application/javascript; charset=utf-8" },
                { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
              ],
            },
          ];
        },
      }),
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
