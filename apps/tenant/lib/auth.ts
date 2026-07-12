// NextAuth 4 config for the tenant app. Credentials (email + password) → JWT
// session. The tenant is a renter: they have NO OrgMembership and relate to data
// via Tenancy.userId, so the JWT embeds only the userId — no org/role scope.
//
// Per-app cookie name (`tenant.session-token`) so the six apps don't clobber
// each other's sessions on the same parent domain.

import { db } from "@repo/db";
import bcrypt from "bcryptjs";
import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";

const COOKIE_NAME = "tenant.session-token";
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
          select: { id: true, name: true, passwordHash: true, active: true },
        });

        if (!user || !user.active || !user.passwordHash) return null;

        const ok = await bcrypt.compare(credentials.password, user.passwordHash);
        if (!ok) return null;

        return { id: user.id, name: user.name };
      },
    }),
  ],
  callbacks: {
    // Copy identity onto the JWT at sign-in; persist across refreshes.
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
      }
      return token;
    },
    // Expose the same fields to `useSession()` on the client.
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id;
      }
      return session;
    },
  },
};
