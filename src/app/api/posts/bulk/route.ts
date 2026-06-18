import { formatZodError } from "@/lib/api-errors";
import { NextRequest, NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/meta/oauth";
import { getOwnerAccountById } from "@/lib/accounts";
import { createAdminClient } from "@/lib/supabase/admin";
import { validateMediaUrlsForOwner } from "@/lib/security/ownership";
import { contentTypeFromMediaType } from "@/lib/content-types";
import { generateBulkSchedule, sanitizeScheduledAt } from "@/lib/smart-schedule";
import { z } from "zod";

const bulkSchema = z
  .object({
    account_id: z.string().uuid().optional(),
    account_ids: z.array(z.string().uuid()).min(1).optional(),
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
  })
  .refine((data) => Boolean(data.account_ids?.length || data.account_id), {
    message: "Selecione pelo menos uma conta",
    path: ["account_ids"],
  });

export async function POST(request: NextRequest) {
  const ownerId = await getSessionUserId();
  if (!ownerId) {
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  }

  const body = await request.json();
  const parsed = bulkSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: formatZodError(parsed.error) }, { status: 400 });
  }

  const requestedAccountIds = [
    ...new Set(parsed.data.account_ids ?? (parsed.data.account_id ? [parsed.data.account_id] : [])),
  ];

  const supabase = createAdminClient();
  const validAccounts = [];

  for (const accountId of requestedAccountIds) {
    const account = await getOwnerAccountById(supabase, ownerId, accountId);
    if (!account) {
      return NextResponse.json({ error: `Conta não encontrada: ${accountId}` }, { status: 404 });
    }
    validAccounts.push(account);
  }

  for (const item of parsed.data.items) {
    const mediaCheck = validateMediaUrlsForOwner(item.media_urls, ownerId);
    if (!mediaCheck.ok) {
      return NextResponse.json({ error: mediaCheck.error }, { status: 403 });
    }
  }

  const now = new Date();
  const schedule = generateBulkSchedule({
    count: parsed.data.items.length,
    startDate: new Date(parsed.data.start_date),
    postsPerDay: parsed.data.posts_per_day,
    hours: parsed.data.hours,
    now,
  });

  const rows = validAccounts.flatMap((account) =>
    parsed.data.items.map((item, index) => ({
      account_id: account.id,
      content_type: contentTypeFromMediaType(parsed.data.media_type),
      media_type: parsed.data.media_type,
      media_urls: item.media_urls,
      caption: item.caption ?? null,
      scheduled_at: sanitizeScheduledAt(schedule[index].toISOString(), now),
    })),
  );

  const { data, error } = await supabase.from("scheduled_posts").insert(rows).select();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(
    {
      created: data?.length ?? 0,
      accounts: validAccounts.length,
      videos: parsed.data.items.length,
      posts: data,
    },
    { status: 201 },
  );
}
