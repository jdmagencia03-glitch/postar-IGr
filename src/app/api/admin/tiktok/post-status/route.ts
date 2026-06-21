import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requirePlatformAdmin } from "@/lib/admin/gate";
import { formatZodError } from "@/lib/api-errors";
import { getSessionUserId } from "@/lib/meta/oauth";
import { createAdminClient } from "@/lib/supabase/admin";
import { getTikTokPostAdminStatus } from "@/lib/tiktok/post-admin";

const bodySchema = z.object({
  postId: z.string().uuid(),
  accountId: z.string().uuid().optional(),
});

/** Status de 1 post TikTok (somente leitura). */
export async function POST(request: NextRequest) {
  const ownerId = await getSessionUserId();
  if (!ownerId) {
    return NextResponse.json({ ok: false, error: "unauthenticated" }, { status: 401 });
  }

  const supabase = createAdminClient();
  const gate = await requirePlatformAdmin(supabase, ownerId);
  if (!gate.ok) {
    return NextResponse.json({ ok: false, error: "forbidden", message: gate.error }, { status: 403 });
  }

  const raw = await request.json().catch(() => ({}));
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: formatZodError(parsed.error) }, { status: 400 });
  }

  const status = await getTikTokPostAdminStatus(
    supabase,
    parsed.data.postId,
    parsed.data.accountId,
  );

  if (!status) {
    return NextResponse.json({ ok: false, error: "post_not_found" }, { status: 404 });
  }

  return NextResponse.json({
    ok: true,
    post: status,
  });
}
