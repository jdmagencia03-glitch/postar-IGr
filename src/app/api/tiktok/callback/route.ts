import { NextRequest } from "next/server";
import { handleTikTokOAuthCallback } from "@/lib/tiktok/callback";

export async function GET(request: NextRequest) {
  return handleTikTokOAuthCallback(request);
}
