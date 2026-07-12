import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // @repo/db opens a pg.Pool at import time — keep the native driver external so
  // Next doesn't try to bundle it into server chunks (and never the client).
  serverExternalPackages: ["pg", "@prisma/client", "@prisma/adapter-pg"],
  // Workspace packages are consumed as raw TS — let Next transpile them.
  transpilePackages: ["@repo/ui", "@repo/shared"],
  // typedRoutes intentionally OFF during the incremental rebuild — nav links to
  // not-yet-created routes (properties/maintenance land in M3) would fail the
  // typed-routes check. Re-enable at cutover (M4) once every route exists.
};

export default nextConfig;
