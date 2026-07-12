// NextAuth 4 config for the agent app. Credentials (email + password) →
// JWT session. The JWT embeds `organizationId` + `role` from the user's
// OrgMembership; `lib/session.ts` decodes that token for tenant scoping.
//
// Per-app cookie name (`agent.session-token`) so the six apps don't clobber
// each other's sessions on the same parent domain.

import { db } from "@repo/db";
import bcrypt from "bcryptjs";
import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";

const COOKIE_NAME = "agent.session-token";
const useSecureCookies = process.env.NEXTAUTH_URL?.startsWith("https://") ?? false;

export const authOptions: NextAuthOptions = {
  secret: process.env.NEXTAUTH_SECRET,
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  cookies: {
    sessionToken: {
      name: COOKIE_NAME,
      options: {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure: useSecureCookies,
      },
    },
  },
  providers: [
    CredentialsProvider({
      name: "Email and password",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials.password) return null;

        const user = await db.user.findUnique({
          where: { email: credentials.email.toLowerCase() },
          select: {
            id: true,
            name: true,
            passwordHash: true,
            active: true,
            memberships: {
              // Staff apps use the first (default) org membership. A real build
              // would let the user pick an active org; the slice takes the first.
              select: { organizationId: true, role: true },
              orderBy: { createdAt: "asc" },
              take: 1,
            },
          },
        });

        if (!user || !user.active || !user.passwordHash) return null;
        const membership = user.memberships[0];
        if (!membership) return null; // no org → not a staff-side user

        const ok = await bcrypt.compare(credentials.password, user.passwordHash);
        if (!ok) return null;

        return {
          id: user.id,
          name: user.name,
          organizationId: membership.organizationId,
          role: membership.role,
        };
      },
    }),
  ],
  callbacks: {
    // Copy identity + org scope onto the JWT at sign-in; persist across refreshes.
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.organizationId = user.organizationId;
        token.role = user.role;
      }
      return token;
    },
    // Expose the same fields to `useSession()` on the client.
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id;
        session.user.organizationId = token.organizationId;
        session.user.role = token.role;
      }
      return session;
    },
  },
};
