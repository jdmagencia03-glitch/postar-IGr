import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { formatZodError } from "@/lib/api-errors";
import { getSessionUserId } from "@/lib/meta/oauth";
import { getOwnerAccountRefs } from "@/lib/posts";
import {
  applyWarmupRedistribution,
  previewWarmupRedistribution,
  resolveScheduleModeForAccount,
} from "@/lib/schedule-redistribute";
import { createAdminClient } from "@/lib/supabase/admin";

const bodySchema = z.object({
  accountId: z.string().uuid(),
  platform: z.enum(["instagram", "tiktok"]),
  apply: z.boolean().optional().default(false),
  warmupDays: z.number().int().min(2).max(5).optional(),
  warmupDayOffset: z.number().int().min(0).optional(),
});

export async function POST(request: NextRequest) {
  const ownerId = await getSessionUserId();
  if (!ownerId) {
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  }

  const parsed = bodySchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: formatZodError(parsed.error) }, { status: 400 });
  }

  const supabase = createAdminClient();
  const refs = await getOwnerAccountRefs(supabase, ownerId);
  const ref = refs.find(
    (account) =>
      account.id === parsed.data.accountId && account.platform === parsed.data.platform,
  );

  if (!ref) {
    return NextResponse.json({ error: "Conta não encontrada" }, { status: 404 });
  }

  const detectedMode = await resolveScheduleModeForAccount(
    supabase,
    parsed.data.platform,
    parsed.data.accountId,
  );

  try {
    const result = parsed.data.apply
      ? await applyWarmupRedistribution({
          supabase,
          platform: parsed.data.platform,
          accountId: parsed.data.accountId,
          warmupDays: parsed.data.warmupDays,
          warmupDayOffset: parsed.data.warmupDayOffset,
        })
      : await previewWarmupRedistribution({
          supabase,
          platform: parsed.data.platform,
          accountId: parsed.data.accountId,
          warmupDays: parsed.data.warmupDays,
          warmupDayOffset: parsed.data.warmupDayOffset,
        });

    return NextResponse.json({
      applied: parsed.data.apply,
      detectedMode,
      ...result,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Falha ao redistribuir aquecimento" },
      { status: 500 },
    );
  }
}
