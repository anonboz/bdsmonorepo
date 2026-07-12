// Augment NextAuth's User / JWT / Session for the GLOBAL admin console. Admin is
// the one app that is NOT org-scoped, so there is NO organizationId here — just
// identity + the platform `admin` role gate.
import type { OrgRole } from "@repo/db";
import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface User {
    id: string;
    role: OrgRole;
  }
  interface Session {
    user: {
      id: string;
      role: OrgRole;
    } & DefaultSession["user"];
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id: string;
    role: OrgRole;
  }
}
