import { NextRequest, NextResponse } from "next/server";
import { checkPassword, setAuthCookie, clearAuthCookie } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const password = typeof body.password === "string" ? body.password : "";

  if (!checkPassword(password)) {
    return NextResponse.json({ error: "Wrong password." }, { status: 401 });
  }

  return setAuthCookie(NextResponse.json({ ok: true }));
}

export async function DELETE() {
  return clearAuthCookie(NextResponse.json({ ok: true }));
}
