import { formatZodError } from "@/lib/api-errors";
import { NextRequest, NextResponse } from "next/server";
import {
  EMPTY_PLAYBOOK,
  getPlaybookForAccount,
  playbookHasContent,
  savePlaybookForAccount,
} from "@/lib/ai/playbook";
import { getSessionUserId } from "@/lib/meta/oauth";
import { z } from "zod";

const playbookFieldsSchema = z.object({
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

const putSchema = playbookFieldsSchema.extend({
  account_id: z.string().uuid(),
});

export async function GET(request: NextRequest) {
  const ownerId = await getSessionUserId();
  if (!ownerId) {
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  }

  const accountId = request.nextUrl.searchParams.get("accountId");
  if (!accountId) {
    return NextResponse.json({ error: "Informe accountId na query string" }, { status: 400 });
  }

  const playbook = await getPlaybookForAccount(ownerId, accountId);
  const merged = { ...EMPTY_PLAYBOOK, ...(playbook ?? {}), owner_id: ownerId, account_id: accountId };

  return NextResponse.json({
    ...merged,
    configured: playbookHasContent(playbook),
    ai_ready: true,
  });
}

export async function PUT(request: NextRequest) {
  const ownerId = await getSessionUserId();
  if (!ownerId) {
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  }

  const body = await request.json();
  const parsed = putSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: formatZodError(parsed.error) }, { status: 400 });
  }

  const { account_id: accountId, ...fields } = parsed.data;
  const payload = {
    brand_name: fields.brand_name?.trim() || null,
    niche: fields.niche?.trim() || null,
    target_audience: fields.target_audience?.trim() || null,
    tone_voice: fields.tone_voice?.trim() || null,
    viral_hooks: fields.viral_hooks?.trim() || null,
    hashtag_strategy: fields.hashtag_strategy?.trim() || null,
    cta_style: fields.cta_style?.trim() || null,
    example_captions: fields.example_captions?.trim() || null,
    avoid_rules: fields.avoid_rules?.trim() || null,
    extra_knowledge: fields.extra_knowledge?.trim() || null,
  };

  const saved = await savePlaybookForAccount(ownerId, accountId, payload);

  return NextResponse.json({
    ...saved,
    account_id: accountId,
    configured: playbookHasContent(saved),
    ai_ready: true,
  });
}
