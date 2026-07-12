// Server-side session resolution for the GLOBAL admin console. Decodes the
// NextAuth JWT directly from the per-app cookie (most reliable in Next 16 route
// handlers + server components).
//
// Admin is NOT org-scoped: there is no organizationId here. The only boundary is
// the platform `admin` role — enforced by requireAdmin() below.

import { ForbiddenError, UNAUTHORIZED } from "@repo/shared";
import type { OrgRole } from "@repo/db";
import { cookies } from "next/headers";
import { decode } from "next-auth/jwt";

const COOKIE_NAME = "admin.session-token";
const SECRET = process.env.NEXTAUTH_SECRET!;

export type SessionContext = {
  userId: string;
  role: OrgRole;
  name: string;
};

async function readSessionCookie(): Promise<string | undefined> {
  const store = await cookies();
  const single = store.get(COOKIE_NAME)?.value;
  if (single) return single;
  // NextAuth chunks large cookies as name.0, name.1, ...
  const chunks: string[] = [];
  for (let i = 0; ; i++) {
    const chunk = store.get(`${COOKIE_NAME}.${i}`)?.value;
    if (!chunk) break;
    chunks.push(chunk);
  }
  return chunks.length ? chunks.join("") : undefined;
}

/** Authenticated context for reads + writes. Throws UNAUTHORIZED (→ 401). */
export async function getSession(): Promise<SessionContext> {
  const raw = await readSessionCookie();
  if (!raw) throw new Error(UNAUTHORIZED);

  const token = await decode({ token: raw, secret: SECRET });
  if (!token?.id || !token?.role) {
    throw new Error(UNAUTHORIZED);
  }

  return {
    userId: token.id,
    role: token.role,
    name: (token.name as string) || "",
  };
}

/** Gate every admin action behind the platform `admin` role. Throws
 * ForbiddenError (→ 403) for anyone else. */
export function requireAdmin(session: SessionContext): void {
  if (session.role !== "admin") {
    throw new ForbiddenError("Admin access required");
  }
}
