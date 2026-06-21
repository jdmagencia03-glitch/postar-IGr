import { NextResponse } from "next/server";
import { isPlatformAdmin, getPlatformAdminHubUsername } from "@/lib/admin/gate";
import { getSessionUserId } from "@/lib/meta/oauth";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET() {
  const ownerId = await getSessionUserId();
  if (!ownerId) {
    return NextResponse.json({ allowed: false, reason: "unauthenticated" }, { status: 401 });
  }

  const supabase = createAdminClient();
  const allowed = await isPlatformAdmin(supabase, ownerId);

  return NextResponse.json({
    allowed,
    hubAccount: getPlatformAdminHubUsername(),
    dryRunDefault: true,
  });
}
