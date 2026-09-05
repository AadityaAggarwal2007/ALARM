import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { issueToken } from "@/lib/ai/token";

export const dynamic = "force-dynamic";

/** Token management is deliberately cookie-only: an agent must not be able to
 *  mint itself more credentials. */
function humanOnly(request: Request): NextResponse | null {
  if (request.headers.get("authorization")) {
    return NextResponse.json(
      { error: "Tokens can only be managed from the signed-in app." },
      { status: 403 }
    );
  }
  return null;
}

export async function GET(request: Request) {
  const denied = humanOnly(request);
  if (denied) return denied;
  const rows = await prisma.apiToken.findMany({
    select: { id: true, name: true, createdAt: true, lastUsedAt: true },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json(rows);
}

export async function POST(request: Request) {
  const denied = humanOnly(request);
  if (denied) return denied;
  const body = await request.json().catch(() => ({}));
  const { id, token } = await issueToken(String(body.name || "agent"));
  // Shown once. Only the hash is stored.
  return NextResponse.json({ id, token });
}

export async function DELETE(request: Request) {
  const denied = humanOnly(request);
  if (denied) return denied;
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id is required." }, { status: 400 });
  await prisma.apiToken.delete({ where: { id } }).catch(() => {});
  return NextResponse.json({ ok: true });
}
