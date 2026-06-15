import { NextRequest, NextResponse } from "next/server";
import { EMPTY_PLAYBOOK } from "@/lib/ai/playbook";
import { getSessionUserId } from "@/lib/meta/oauth";
import { createAdminClient } from "@/lib/supabase/admin";
import { z } from "zod";

const playbookSchema = z.object({
  brand_name: z.string().max(200).optional(),
  niche: z.string().max(500).optional(),
  target_audience: z.string().max(3000).optional(),
  tone_voice: z.string().max(2000).optional(),
  viral_hooks: z.string().max(5000).optional(),
  hashtag_strategy: z.string().max(3000).optional(),
  cta_style: z.string().max(2000).optional(),
  example_captions: z.string().max(8000).optional(),
  avoid_rules: z.string().max(2000).optional(),
  extra_knowledge: z.string().max(15000).optional(),
});

export async function GET() {
  const ownerId = await getSessionUserId();
  if (!ownerId) {
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  }

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("ai_playbooks")
    .select("*")
    .eq("owner_id", ownerId)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    ...EMPTY_PLAYBOOK,
    ...(data ?? {}),
    owner_id: ownerId,
    has_openai_key: Boolean(process.env.OPENAI_API_KEY),
  });
}

export async function PUT(request: NextRequest) {
  const ownerId = await getSessionUserId();
  if (!ownerId) {
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  }

  const body = await request.json();
  const parsed = playbookSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const supabase = createAdminClient();
  const payload = {
    owner_id: ownerId,
    brand_name: parsed.data.brand_name?.trim() || null,
    niche: parsed.data.niche?.trim() || null,
    target_audience: parsed.data.target_audience?.trim() || null,
    tone_voice: parsed.data.tone_voice?.trim() || null,
    viral_hooks: parsed.data.viral_hooks?.trim() || null,
    hashtag_strategy: parsed.data.hashtag_strategy?.trim() || null,
    cta_style: parsed.data.cta_style?.trim() || null,
    example_captions: parsed.data.example_captions?.trim() || null,
    avoid_rules: parsed.data.avoid_rules?.trim() || null,
    extra_knowledge: parsed.data.extra_knowledge?.trim() || null,
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from("ai_playbooks")
    .upsert(payload, { onConflict: "owner_id" })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    ...data,
    has_openai_key: Boolean(process.env.OPENAI_API_KEY),
  });
}
