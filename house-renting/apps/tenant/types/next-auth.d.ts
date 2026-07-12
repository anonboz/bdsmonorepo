// Augment NextAuth's User / JWT / Session with our identity field. The tenant
// app is NOT org-scoped: a tenant relates to data through Tenancy.userId, so the
// session carries only the userId — no organizationId/role.
import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface User {
    id: string;
  }
  interface Session {
    user: {
      id: string;
    } & DefaultSession["user"];
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id: string;
  }
}
