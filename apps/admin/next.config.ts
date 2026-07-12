import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // @repo/db opens a pg.Pool at import time — keep the native driver external so
  // Next doesn't try to bundle it into server chunks (and never the client).
  serverExternalPackages: ["pg", "@prisma/client", "@prisma/adapter-pg"],
  // Workspace packages are consumed as raw TS — let Next transpile them.
  transpilePackages: ["@repo/ui", "@repo/shared"],
  // typedRoutes intentionally OFF during the incremental rebuild — nav links to
  // not-yet-created routes would fail the typed-routes check.
};

export default nextConfig;
