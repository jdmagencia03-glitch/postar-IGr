import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { OwnerIdSchema } from "@/lib/admin/schemas";
import { requirePlatformAdmin } from "@/lib/admin/gate";
import { formatZodError } from "@/lib/api-errors";
import { configureInstagramPlaybook } from "@/lib/instagram/configure-playbook";
import { getSessionUserId } from "@/lib/meta/oauth";
import { createAdminClient } from "@/lib/supabase/admin";

const optionalText = (max: number) => z.string().max(max).nullish();

const playbookFieldsSchema = z.object({
  brand_name: optionalText(200),
  niche: optionalText(500),
  target_audience: optionalText(3000),
  tone_voice: optionalText(2000),
  viral_hooks: optionalText(5000),
  hashtag_strategy: optionalText(3000),
  cta_style: optionalText(2000),
  example_captions: optionalText(8000),
  avoid_rules: optionalText(2000),
  extra_knowledge: optionalText(15000),
});

const bodySchema = z.object({
  ownerId: OwnerIdSchema,
  accountId: z.string().uuid(),
  playbookName: z.string().max(200).optional(),
  preset: z
    .enum(["deolhonoshape_fitness_dark", "retr0fy_retro_games", "diario_da_musa_feminino"])
    .optional(),
  playbook: playbookFieldsSchema.optional(),
  confirm: z.boolean().optional().default(false),
});

/** Configura playbook de conteúdo para 1 conta Instagram (admin). */
export async function POST(request: NextRequest) {
  const sessionOwnerId = await getSessionUserId();
  if (!sessionOwnerId) {
    return NextResponse.json({ ok: false, error: "unauthenticated" }, { status: 401 });
  }

  const supabase = createAdminClient();
  const gate = await requirePlatformAdmin(supabase, sessionOwnerId);
  if (!gate.ok) {
    return NextResponse.json({ ok: false, error: "forbidden", message: gate.error }, { status: 403 });
  }

  const raw = await request.json().catch(() => ({}));
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: formatZodError(parsed.error) }, { status: 400 });
  }

  try {
    const result = await configureInstagramPlaybook({
      supabase,
      ownerId: parsed.data.ownerId,
      accountId: parsed.data.accountId,
      playbookName: parsed.data.playbookName,
      preset: parsed.data.preset,
      playbook: parsed.data.playbook,
      confirm: parsed.data.confirm,
    });

    if (!result.ok) {
      const status = result.error === "account_not_found" ? 404 : 400;
      return NextResponse.json(result, { status });
    }

    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: "configure_failed",
        message: err instanceof Error ? err.message : "Falha ao configurar playbook",
      },
      { status: 500 },
    );
  }
}
