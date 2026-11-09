import { NextResponse } from "next/server";
import { COOKIE_NAME, safeNextPath, sessionToken, tokensEqual } from "@/lib/auth";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const form = await request.formData();
  const submitted = String(form.get("password") ?? "");
  const expected = process.env.DASHBOARD_PASSWORD ?? "";
  const nextPath = safeNextPath(String(form.get("next") ?? "/"));
  const ok = await tokensEqual(submitted, expected);
  const destination = new URL(ok ? nextPath : "/login?fout=1", request.url);
  const response = NextResponse.redirect(destination, 303);
  if (ok) {
    response.cookies.set(COOKIE_NAME, await sessionToken(expected), {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 14,
    });
  }
  return response;
}
