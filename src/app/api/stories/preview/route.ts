import { formatZodError } from "@/lib/api-errors";
import { NextRequest, NextResponse } from "next/server";
import { getOwnerAccountById } from "@/lib/accounts";
import { getSessionUserId } from "@/lib/meta/oauth";
import { buildStorySchedulePlan } from "@/lib/stories/plan";
import { STORY_CTA_OPTIONS, STORY_OBJECTIVES } from "@/lib/stories/types";
import { parseCustomSchedulePayload } from "@/lib/smart-schedule";
import { createAdminClient } from "@/lib/supabase/admin";
import { validateMediaUrlsForOwner } from "@/lib/security/ownership";
import { z } from "zod";

const customScheduleSchema = z.object({
  posts_per_day: z.number().int().min(1).max(48),
  time_slots: z.array(z.string()).max(48).optional(),
  start_time: z.string().optional(),
  end_time: z.string().optional(),
});

const previewSchema = z
  .object({
    account_id: z.string().uuid(),
    story_objective: z.string().min(1).max(200),
    story_cta: z.string().min(1).max(200),
    story_link: z.string().url().optional().nullable(),
    schedule_mode: z.enum(["today", "auto", "warmup", "custom"]).optional(),
    custom_schedule: customScheduleSchema.optional(),
    items: z
      .array(
        z.object({
          media_url: z.string().url(),
          filename: z.string().optional(),
        }),
      )
      .min(1)
      .max(50),
  })
  .refine(
    (data) => data.schedule_mode !== "custom" || Boolean(data.custom_schedule),
    { message: "Informe horários no modo personalizado", path: ["custom_schedule"] },
  );

export async function POST(request: NextRequest) {
  const ownerId = await getSessionUserId();
  if (!ownerId) {
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  }

  const body = await request.json();
  const parsed = previewSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: formatZodError(parsed.error) }, { status: 400 });
  }

  const supabase = createAdminClient();
  const account = await getOwnerAccountById(supabase, ownerId, parsed.data.account_id);
  if (!account) {
    return NextResponse.json({ error: "Conta não encontrada" }, { status: 404 });
  }

  for (const item of parsed.data.items) {
    const mediaCheck = validateMediaUrlsForOwner([item.media_url], ownerId);
    if (!mediaCheck.ok) {
      return NextResponse.json({ error: mediaCheck.error }, { status: 403 });
    }
  }

  const scheduleMode = parsed.data.schedule_mode ?? "auto";
  const custom =
    scheduleMode === "custom" && parsed.data.custom_schedule
      ? parseCustomSchedulePayload(parsed.data.custom_schedule)
      : undefined;

  if (scheduleMode === "custom" && (!custom || !custom.timeSlots.length)) {
    return NextResponse.json({ error: "Horários inválidos no modo personalizado." }, { status: 400 });
  }

  const plan = await buildStorySchedulePlan({
    items: parsed.data.items,
    ownerId,
    accountId: account.id,
    username: account.ig_username ?? "perfil",
    storyObjective: parsed.data.story_objective,
    storyCta: parsed.data.story_cta,
    storyLink: parsed.data.story_link,
    schedule_mode: scheduleMode === "warmup" ? "auto" : scheduleMode,
    custom_schedule: parsed.data.custom_schedule,
  });

  return NextResponse.json({
    ...plan,
    account: { id: account.id, username: account.ig_username },
    objectives: STORY_OBJECTIVES,
    cta_options: STORY_CTA_OPTIONS,
  });
}
