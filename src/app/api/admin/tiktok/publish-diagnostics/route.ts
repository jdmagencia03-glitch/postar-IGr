import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requirePlatformAdmin } from "@/lib/admin/gate";
import { resolvePlatformAdminOwnerId } from "@/lib/admin/resolve-owner";
import { authorizeCronRequest } from "@/lib/admin/cron-auth";
import { formatZodError } from "@/lib/api-errors";
import { getSessionUserId } from "@/lib/meta/oauth";
import { createAdminClient } from "@/lib/supabase/admin";
import { getOwnerTikTokAccountById } from "@/lib/tiktok/accounts";
import { buildTikTokPublishDiagnostics } from "@/lib/tiktok/publish-diagnostics";

const bodySchema = z.object({
  accountId: z.string().uuid(),
  sampleVideoUrl: z.string().url().optional(),
});

/** Diagnóstico de publicação TikTok (somente leitura). */
export async function POST(request: NextRequest) {
  const supabase = createAdminClient();
  let ownerId = await getSessionUserId();

  if (!ownerId && authorizeCronRequest(request)) {
    ownerId = await resolvePlatformAdminOwnerId(supabase);
  }

  if (!ownerId) {
    return NextResponse.json({ ok: false, error: "unauthenticated" }, { status: 401 });
  }

  const gate = await requirePlatformAdmin(supabase, ownerId);
  if (!gate.ok) {
    return NextResponse.json({ ok: false, error: "forbidden", message: gate.error }, { status: 403 });
  }

  const raw = await request.json().catch(() => ({}));
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: formatZodError(parsed.error) }, { status: 400 });
  }

  const account = await getOwnerTikTokAccountById(supabase, ownerId, parsed.data.accountId);
  if (!account) {
    return NextResponse.json({ ok: false, error: "account_not_found" }, { status: 404 });
  }

  const diagnostics = await buildTikTokPublishDiagnostics({
    supabase,
    account,
    sampleVideoUrl: parsed.data.sampleVideoUrl,
  });

  return NextResponse.json({
    ok: true,
    ...diagnostics,
  });
}
