import { NextResponse, type NextRequest } from "next/server";

const COOKIE_NAME = process.env.SESSION_COOKIE_NAME ?? "examforge_session";

/**
 * Coarse authentication guard. It only verifies that a session cookie exists;
 * the definitive authentication, tenant resolution, and authorization happen
 * server-side in route handlers and server components. This proxy exists so
 * unauthenticated browser navigation to /app is redirected before any page
 * renders.
 */
export function proxy(request: NextRequest) {
  const token = request.cookies.get(COOKIE_NAME)?.value;
  if (token) return NextResponse.next();

  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.searchParams.set("next", request.nextUrl.pathname);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/app/:path*"],
};