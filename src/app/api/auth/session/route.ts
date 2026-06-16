import { NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/auth/session";

export async function GET() {
  const userId = await getSessionUserId();
  return NextResponse.json({ authenticated: Boolean(userId) });
}
