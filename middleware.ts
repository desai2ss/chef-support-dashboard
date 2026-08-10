import { auth } from "@/auth";
import { NextResponse } from "next/server";

export default auth((req) => {
  const { pathname } = req.nextUrl;
  const isAuthRoute = pathname.startsWith("/api/auth") || pathname.startsWith("/signin");
  // Cron endpoints authenticate themselves via CRON_SECRET Bearer header.
  // If we let middleware guard them, Vercel-cron's GET is redirected to
  // /signin (307), the rollup never runs, and no error surfaces in logs.
  const isCronRoute = pathname.startsWith("/api/cron");
  if (isAuthRoute || isCronRoute) return NextResponse.next();
  if (!req.auth) {
    const signinUrl = new URL("/signin", req.nextUrl.origin);
    signinUrl.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(signinUrl);
  }
  return NextResponse.next();
});

export const config = {
  // run middleware on everything except static assets
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
