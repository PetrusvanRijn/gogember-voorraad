import { NextResponse, type NextRequest } from "next/server";
import { COOKIE_NAME, cookieMatches } from "@/lib/auth";

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const signedIn = await cookieMatches(request.cookies.get(COOKIE_NAME)?.value, process.env.DASHBOARD_PASSWORD);

  if (pathname.startsWith("/login")) {
    if (signedIn) {
      const home = request.nextUrl.clone();
      home.pathname = "/";
      home.search = "";
      return NextResponse.redirect(home);
    }
    return NextResponse.next();
  }

  if (pathname.startsWith("/api/login") || pathname.startsWith("/api/cron")) return NextResponse.next();

  if (!signedIn) {
    const login = request.nextUrl.clone();
    login.pathname = "/login";
    login.search = "";
    if (pathname !== "/") login.searchParams.set("next", pathname);
    return NextResponse.redirect(login);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg).*)"],
};
