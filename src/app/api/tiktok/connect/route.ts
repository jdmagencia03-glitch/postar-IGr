import { NextRequest } from "next/server";
import { startTikTokOAuth } from "@/lib/tiktok/connect";

export async function GET(request: NextRequest) {
  return startTikTokOAuth(request);
}
