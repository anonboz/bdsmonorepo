import withSerwistInit from "@serwist/next";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // @repo/db opens a pg.Pool at import time — keep the native driver external so
  // Next doesn't try to bundle it into server chunks (and never the client).
  serverExternalPackages: ["pg", "@prisma/client", "@prisma/adapter-pg"],
  // Workspace packages are consumed as raw TS — let Next transpile them.
  transpilePackages: ["@repo/ui", "@repo/shared"],
  // typedRoutes intentionally OFF during the incremental rebuild — nav links to
  // not-yet-created routes (schedule/profile land later) would fail the
  // typed-routes check. Re-enable at cutover once every route exists.
};

const withSerwist = withSerwistInit({
  swSrc: "app/sw.ts",
  swDest: "public/sw.js",
  // Skip SW registration in dev — avoids stale-cache confusion while iterating.
  disable: process.env.NODE_ENV !== "production",
});

export default withSerwist(nextConfig);
