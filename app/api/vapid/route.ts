import { NextResponse } from "next/server";
import { publicKey, pushReady } from "@/lib/push";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    enabled: pushReady(),
    publicKey: pushReady() ? publicKey() : null,
  });
}
