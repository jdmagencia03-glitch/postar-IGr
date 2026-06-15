import { NextResponse } from "next/server";
import { getMetaAuthUrl } from "@/lib/meta/oauth";
import { randomBytes } from "crypto";

export async function GET() {
  const state = randomBytes(16).toString("hex");
  const response = NextResponse.redirect(getMetaAuthUrl(state));
  response.cookies.set("meta_oauth_state", state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 600,
    path: "/",
  });
  return response;
}
