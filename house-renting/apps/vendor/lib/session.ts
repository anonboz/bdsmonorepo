// Server-side session resolution. Decodes the NextAuth JWT directly from the
// per-app cookie (most reliable in Next 16 route handlers + server components).
// The org boundary lives here: `organizationId` comes from the token and is the
// ONLY source services may use for tenant scoping — never req.body/params/query.

import { ForbiddenError, UNAUTHORIZED } from "@repo/shared";
import type { OrgRole } from "@repo/db";
import { cookies } from "next/headers";
import { decode } from "next-auth/jwt";

const COOKIE_NAME = "vendor.session-token";
const SECRET = process.env.NEXTAUTH_SECRET!;

export type SessionContext = {
  userId: string;
  organizationId: string;
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
  if (!token?.id || !token?.organizationId || !token?.role) {
    throw new Error(UNAUTHORIZED);
  }

  return {
    userId: token.id,
    organizationId: token.organizationId,
    role: token.role,
    name: (token.name as string) || "",
  };
}

/** Gate a write behind one or more org roles. Throws ForbiddenError (→ 403). */
export function requireRole(session: SessionContext, ...allowed: OrgRole[]): void {
  if (!allowed.includes(session.role)) {
    throw new ForbiddenError("You don't have permission to do that");
  }
}
