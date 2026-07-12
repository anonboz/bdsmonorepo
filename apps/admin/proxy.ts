// Auth gate. Every non-public route requires a decodable NextAuth JWT in the
// per-app cookie; otherwise bounce to /login with a callback. Route handlers +
// server components still re-check via getSession() — this is the cheap edge cut.

import { getToken } from "next-auth/jwt";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export async function proxy(req: NextRequest) {
  const token = await getToken({
    req,
    secret: process.env.NEXTAUTH_SECRET,
    cookieName: "admin.session-token",
  });

  if (!token) {
    const url = new URL("/login", req.url);
    url.searchParams.set("callbackUrl", req.nextUrl.pathname);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  // Protect everything except Next internals, the auth API, and the login page.
  matcher: ["/((?!api|_next/static|_next/image|login|favicon.ico).*)"],
};
