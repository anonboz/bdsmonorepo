// NextAuth 4 config for the GLOBAL admin console. Credentials (email + password)
// → JWT session. Unlike the org-scoped staff apps, admin embeds NO
// organizationId: it is cross-org. The gate is instead the platform `admin`
// role — a user must have at least one OrgMembership with role "admin" to sign
// in; everyone else is rejected.
//
// Per-app cookie name (`admin.session-token`) so the apps don't clobber each
// other's sessions on the same parent domain.

import { db } from "@repo/db";
import bcrypt from "bcryptjs";
import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";

const COOKIE_NAME = "admin.session-token";
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
            // Admin gate: only platform-admin memberships count. If the user has
            // none, they are not an admin and cannot sign in here.
            memberships: {
              select: { role: true },
              where: { role: "admin" },
            },
          },
        });

        if (!user || !user.active || !user.passwordHash) return null;
        // Must hold at least one platform-admin membership.
        if (user.memberships.length === 0) return null;

        const ok = await bcrypt.compare(credentials.password, user.passwordHash);
        if (!ok) return null;

        return {
          id: user.id,
          name: user.name,
          role: "admin",
        };
      },
    }),
  ],
  callbacks: {
    // Copy identity + admin role onto the JWT at sign-in; persist across refreshes.
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.role = "admin";
      }
      return token;
    },
    // Expose the same fields to `useSession()` on the client.
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id;
        session.user.role = token.role;
      }
      return session;
    },
  },
};
