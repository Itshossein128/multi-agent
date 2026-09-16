import { NextResponse } from "next/server";
import { auth } from "@/auth.edge";

// Proxy to protect routes
export default auth((req) => {
  const isLoggedIn = !!req.auth;
  const { nextUrl } = req;
  const isAuthRoute = nextUrl.pathname.startsWith("/login") || nextUrl.pathname.startsWith("/register");
  const isApiAuthRoute = nextUrl.pathname.startsWith("/api/auth");

  // Always allow NextAuth API routes
  if (isApiAuthRoute) {
    return;
  }

  // Allow public assets
  if (
    nextUrl.pathname.match(/\.(png|jpg|jpeg|gif|svg|ico)$/) ||
    nextUrl.pathname.startsWith("/_next")
  ) {
    return;
  }

  if (isAuthRoute) {
    if (isLoggedIn) {
      return NextResponse.redirect(new URL("/", nextUrl));
    }
    return;
  }

  // All other routes are protected
  if (!isLoggedIn) {
    let callbackUrl = nextUrl.pathname;
    if (nextUrl.search) {
      callbackUrl += nextUrl.search;
    }

    const encodedCallbackUrl = encodeURIComponent(callbackUrl);
    return NextResponse.redirect(new URL(`/login?callbackUrl=${encodedCallbackUrl}`, nextUrl));
  }

  return;
});

// Optionally, don't invoke Proxy on some paths
export const config = {
  matcher: ['/((?!.+\\.[\\w]+$|_next).*)', '/', '/(api|trpc)(.*)'],
};
