import { authorizeCronRequest } from "@/lib/admin/cron-auth";
import { resolvePlatformAdminOwnerId } from "@/lib/admin/resolve-owner";
import { getSessionUserId } from "@/lib/meta/oauth";
import { getOwnerAccountRefs } from "@/lib/posts";
import { createAdminClient } from "@/lib/supabase/admin";
import { NextRequest, NextResponse } from "next/server";

/** Lista contas do hub admin — útil para confirmar UUIDs antes do hotfix. */
export async function GET(request: NextRequest) {
  const supabase = createAdminClient();
  let ownerId = await getSessionUserId();

  if (!ownerId && authorizeCronRequest(request)) {
    ownerId = await resolvePlatformAdminOwnerId(supabase);
  }

  if (!ownerId) {
    return NextResponse.json({ ok: false, error: "unauthenticated" }, { status: 401 });
  }

  const refs = await getOwnerAccountRefs(supabase, ownerId);
  const instagram = refs
    .filter((ref) => ref.platform === "instagram")
    .map((ref) => ({
      handle: `@${(ref.username ?? "").replace(/^@/, "")}`,
      accountId: ref.id,
      platform: "instagram" as const,
    }));
  const tiktok = refs
    .filter((ref) => ref.platform === "tiktok")
    .map((ref) => ({
      handle: `@${(ref.username ?? "").replace(/^@/, "")}`,
      accountId: ref.id,
      platform: "tiktok" as const,
    }));

  return NextResponse.json({ ok: true, instagram, tiktok });
}
