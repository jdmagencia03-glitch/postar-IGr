import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requirePlatformAdmin } from "@/lib/admin/gate";
import { formatZodError } from "@/lib/api-errors";
import { getSessionUserId } from "@/lib/meta/oauth";
import { createAdminClient } from "@/lib/supabase/admin";
import { getOwnerTikTokAccountById } from "@/lib/tiktok/accounts";
import { listTikTokNextPendingPosts } from "@/lib/tiktok/next-pending-posts";

const bodySchema = z.object({
  accountId: z.string().uuid(),
  limit: z.number().int().min(1).max(50).optional().default(10),
});

/** Lista próximos posts TikTok pendentes (somente leitura). */
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

  const account = await getOwnerTikTokAccountById(supabase, ownerId, parsed.data.accountId);
  if (!account) {
    return NextResponse.json({ ok: false, error: "account_not_found" }, { status: 404 });
  }

  try {
    const result = await listTikTokNextPendingPosts({
      supabase,
      account,
      limit: parsed.data.limit,
    });

    return NextResponse.json({
      ok: true,
      ...result,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha ao listar posts pendentes";
    return NextResponse.json({ ok: false, error: "list_failed", message }, { status: 500 });
  }
}
