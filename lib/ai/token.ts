import { createHash, randomBytes } from "crypto";
import { prisma } from "../db";

/**
 * Bearer tokens for agents.
 *
 * The human UI rides a cookie, which an MCP server or a model calling from
 * elsewhere cannot obtain. Tokens are stored hashed — the plaintext is shown
 * once, at creation, and is unrecoverable after that.
 */

const PREFIX = "disc_";

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function issueToken(name: string): Promise<{ id: string; token: string }> {
  const token = PREFIX + randomBytes(24).toString("base64url");
  const id = randomBytes(8).toString("hex");
  await prisma.apiToken.create({
    data: { id, name: name.slice(0, 60) || "agent", tokenHash: hashToken(token) },
  });
  return { id, token };
}

/** Returns the token row when valid, and records the use. */
export async function verifyToken(token: string) {
  if (!token.startsWith(PREFIX)) return null;
  const row = await prisma.apiToken.findUnique({
    where: { tokenHash: hashToken(token) },
  });
  if (!row) return null;
  // Best-effort; a failed touch must never reject a valid request.
  prisma.apiToken
    .update({ where: { id: row.id }, data: { lastUsedAt: new Date() } })
    .catch(() => {});
  return row;
}

export function bearerFrom(request: Request): string | null {
  const header = request.headers.get("authorization") || "";
  const m = /^Bearer\s+(.+)$/i.exec(header.trim());
  return m ? m[1].trim() : null;
}
