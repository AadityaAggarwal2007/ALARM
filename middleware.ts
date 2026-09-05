import { NextRequest, NextResponse } from "next/server";

const COOKIE = "alarm_session";

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function sessionToken(): Promise<string> {
  // Kept out of source on purpose — see lib/auth.ts.
  return sha256Hex((process.env.ALARM_PASSWORD || "") + ":alarm-app-salt");
}

const PUBLIC = ["/api/auth", "/sw.js", "/manifest.webmanifest", "/icons/"];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (PUBLIC.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  // Humans arrive with a cookie.
  const cookie = request.cookies.get(COOKIE)?.value;
  if (cookie && cookie === (await sessionToken())) return NextResponse.next();

  // Agents arrive with a bearer token. The cookie flow needs a browser and a
  // login form, which an MCP server or a model calling from elsewhere has
  // neither of. Validation itself happens in the route: the Edge runtime has
  // no database access, so middleware only confirms a token was presented.
  const auth = request.headers.get("authorization") || "";
  if (/^Bearer\s+disc_/i.test(auth.trim()) && pathname.startsWith("/api/")) {
    return NextResponse.next();
  }

  if (pathname.startsWith("/api/")) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "Unauthorized. Send 'Authorization: Bearer <token>'. Create a token in Settings → Agent access.",
      },
      { status: 401 }
    );
  }

  const url = request.nextUrl.clone();
  url.pathname = "/login";
  return NextResponse.rewrite(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
