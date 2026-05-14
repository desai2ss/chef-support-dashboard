import { auth } from "@/auth";
import { NextResponse } from "next/server";

export default auth((req) => {
  const { pathname } = req.nextUrl;
  const isAuthRoute = pathname.startsWith("/api/auth") || pathname.startsWith("/signin");
  if (isAuthRoute) return NextResponse.next();
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
