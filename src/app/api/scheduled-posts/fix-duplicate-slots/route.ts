import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { formatZodError } from "@/lib/api-errors";
import { getSessionUserId } from "@/lib/meta/oauth";
import { getOwnerAccountRefs } from "@/lib/posts";
import {
  applyDuplicateSlotFixes,
  previewDuplicateSlotFixes,
} from "@/lib/schedule-fix-duplicates";
import { createAdminClient } from "@/lib/supabase/admin";

const bodySchema = z.object({
  accountId: z.string().uuid(),
  platform: z.enum(["instagram", "tiktok"]),
  apply: z.boolean().optional().default(false),
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
    (account) => account.id === parsed.data.accountId && account.platform === parsed.data.platform,
  );

  if (!ref) {
    return NextResponse.json({ error: "Conta não encontrada" }, { status: 404 });
  }

  try {
    const result = parsed.data.apply
      ? await applyDuplicateSlotFixes({
          supabase,
          platform: parsed.data.platform,
          accountId: parsed.data.accountId,
        })
      : await previewDuplicateSlotFixes({
          supabase,
          platform: parsed.data.platform,
          accountId: parsed.data.accountId,
        });

    return NextResponse.json({
      applied: parsed.data.apply,
      duplicateGroups: result.duplicateGroups.length,
      moves: result.moves,
      preview: result,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Falha ao corrigir horários duplicados" },
      { status: 500 },
    );
  }
}

export async function GET(request: NextRequest) {
  const ownerId = await getSessionUserId();
  if (!ownerId) {
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  }

  const accountId = request.nextUrl.searchParams.get("accountId");
  const platform = request.nextUrl.searchParams.get("platform") as "instagram" | "tiktok" | null;

  if (!accountId || !platform) {
    return NextResponse.json({ error: "Informe accountId e platform" }, { status: 400 });
  }

  const supabase = createAdminClient();
  const refs = await getOwnerAccountRefs(supabase, ownerId);
  if (!refs.some((account) => account.id === accountId && account.platform === platform)) {
    return NextResponse.json({ error: "Conta não encontrada" }, { status: 404 });
  }

  const preview = await previewDuplicateSlotFixes({ supabase, platform, accountId });
  return NextResponse.json(preview);
}
