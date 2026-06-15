import { NextRequest, NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/meta/oauth";
import { createAdminClient } from "@/lib/supabase/admin";
import { generateBulkSchedule } from "@/lib/utils";
import { z } from "zod";

const bulkSchema = z.object({
  account_id: z.string().uuid(),
  media_type: z.enum(["IMAGE", "REELS", "CAROUSEL"]),
  items: z
    .array(
      z.object({
        media_urls: z.array(z.string().url()).min(1),
        caption: z.string().optional(),
      }),
    )
    .min(1),
  start_date: z.string(),
  posts_per_day: z.number().min(1).max(10),
  hours: z.array(z.number().min(0).max(23)).min(1),
});

export async function POST(request: NextRequest) {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  }

  const body = await request.json();
  const parsed = bulkSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const supabase = createAdminClient();

  const { data: account } = await supabase
    .from("instagram_accounts")
    .select("id")
    .eq("id", parsed.data.account_id)
    .eq("user_id", userId)
    .single();

  if (!account) {
    return NextResponse.json({ error: "Conta não encontrada" }, { status: 404 });
  }

  const schedule = generateBulkSchedule({
    count: parsed.data.items.length,
    startDate: new Date(parsed.data.start_date),
    postsPerDay: parsed.data.posts_per_day,
    hours: parsed.data.hours,
  });

  const rows = parsed.data.items.map((item, index) => ({
    account_id: parsed.data.account_id,
    media_type: parsed.data.media_type,
    media_urls: item.media_urls,
    caption: item.caption ?? null,
    scheduled_at: schedule[index].toISOString(),
  }));

  const { data, error } = await supabase
    .from("scheduled_posts")
    .insert(rows)
    .select();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ created: data?.length ?? 0, posts: data }, { status: 201 });
}
