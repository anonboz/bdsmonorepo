// Augment NextAuth's User / JWT / Session with our org-scope fields so the
// authorize() return, the jwt callback, and `lib/session.ts` are all typed.
import type { OrgRole } from "@repo/db";
import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface User {
    id: string;
    organizationId: string;
    role: OrgRole;
  }
  interface Session {
    user: {
      id: string;
      organizationId: string;
      role: OrgRole;
    } & DefaultSession["user"];
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id: string;
    organizationId: string;
    role: OrgRole;
  }
}
