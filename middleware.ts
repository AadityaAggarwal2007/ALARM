import { NextRequest, NextResponse } from "next/server";

const COOKIE = "alarm_session";

async function computeToken(): Promise<string> {
  // Kept out of source on purpose — see lib/auth.ts.
  const password = process.env.ALARM_PASSWORD || "";
  const data = new TextEncoder().encode(password + ":alarm-app-salt");
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

const PUBLIC = ["/api/auth", "/sw.js", "/manifest.webmanifest", "/icons/"];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (PUBLIC.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  const cookie = request.cookies.get(COOKIE)?.value;
  const token = await computeToken();
  if (cookie === token) return NextResponse.next();

  // API calls get a 401; page requests get redirected to login.
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = request.nextUrl.clone();
  url.pathname = "/login";
  return NextResponse.rewrite(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
