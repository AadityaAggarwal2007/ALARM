import { NextResponse } from "next/server";
import { bearerFrom, verifyToken } from "./token";

/**
 * Confirms a request may write.
 *
 * Middleware runs on the Edge runtime and cannot query SQLite, so it only
 * checks that a bearer token was *presented*. The real check belongs here,
 * where the database is reachable. A request with no Authorization header
 * already passed the cookie check in middleware and is a signed-in human.
 */
export async function requireAgent(request: Request): Promise<NextResponse | null> {
  const token = bearerFrom(request);
  if (!token) return null; // cookie session, already verified upstream

  const row = await verifyToken(token);
  if (!row) {
    return NextResponse.json(
      { ok: false, error: "Invalid or revoked token." },
      { status: 401 }
    );
  }
  return null;
}
