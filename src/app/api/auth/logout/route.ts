import { NextResponse } from "next/server";
import { clearSession } from "@/lib/meta/oauth";

export async function GET() {
  await clearSession();
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  return NextResponse.redirect(`${appUrl}/login`);
}

export async function POST() {
  return GET();
}
