import { NextResponse, type NextRequest } from "next/server";
import { jwtVerify } from "jose";
import { COOKIE } from "@/lib/auth/session";

/**
 * Redirects only. This is NOT the authorization boundary.
 *
 * Middleware decides which page the browser lands on; every route handler
 * independently re-derives the tenant via session() and every query filters on
 * it. If this file were deleted the app would still be secure — it would just
 * show signed-out users an empty chat screen instead of the login page.
 *
 * Guarding data here instead would put the whole tenancy boundary one matcher
 * typo away from a full leak.
 */
export const config = { matcher: ["/chat/:path*", "/admin", "/login", "/register"] };

export async function middleware(req: NextRequest) {
  const token = req.cookies.get(COOKIE)?.value;
  const secret = process.env.SESSION_SECRET;

  let signedIn = false;
  if (token && secret) {
    try {
      await jwtVerify(token, new TextEncoder().encode(secret));
      signedIn = true;
    } catch {
      signedIn = false;
    }
  }

  const path = req.nextUrl.pathname;
  if (!signedIn && (path.startsWith("/chat") || path === "/admin"))
    return NextResponse.redirect(new URL("/login", req.url));
  if (signedIn && (path === "/login" || path === "/register"))
    return NextResponse.redirect(new URL("/chat", req.url));

  const res = NextResponse.next();
  // Signed-in screens must not survive a sign-out. Without no-store the back
  // button restores the previous account's chat from the bfcache — fully
  // rendered, from memory, without a request the server could refuse.
  if (path.startsWith("/chat") || path === "/admin")
    res.headers.set("cache-control", "private, no-store");
  return res;
}
