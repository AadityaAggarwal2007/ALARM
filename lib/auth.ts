import { NextRequest, NextResponse } from "next/server";
import { createHash } from "crypto";

// Never hardcode the real password here — this file is committed. It lives in
// .env.local, which is gitignored. With no ALARM_PASSWORD set the app fails
// closed rather than falling back to a guessable default.
const PASSWORD = process.env.ALARM_PASSWORD || "";
const COOKIE = "alarm_session";

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

const TOKEN = hash(PASSWORD + ":alarm-app-salt");

export function isAuthed(request: NextRequest): boolean {
  return request.cookies.get(COOKIE)?.value === TOKEN;
}

export function checkPassword(password: string): boolean {
  if (!PASSWORD) return false;
  return password === PASSWORD;
}

export function setAuthCookie(response: NextResponse): NextResponse {
  response.cookies.set(COOKIE, TOKEN, {
    httpOnly: true,
    sameSite: "strict",
    secure: true,
    path: "/",
    maxAge: 365 * 24 * 60 * 60,
  });
  return response;
}

export function clearAuthCookie(response: NextResponse): NextResponse {
  response.cookies.delete(COOKIE);
  return response;
}
