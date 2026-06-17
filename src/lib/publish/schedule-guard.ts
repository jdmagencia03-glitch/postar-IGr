import type { createAdminClient } from "@/lib/supabase/admin";

type AdminClient = ReturnType<typeof createAdminClient>;

export async function findPendingPostByMediaUrl(
  supabase: AdminClient,
  params: {
    platform: "instagram" | "tiktok";
    accountId: string;
    mediaUrl: string;
  },
) {
  let query = supabase
    .from("scheduled_posts")
    .select("id, scheduled_at, status")
    .in("status", ["pending", "processing"])
    .contains("media_urls", [params.mediaUrl])
    .limit(1);

  if (params.platform === "tiktok") {
    query = query.eq("tiktok_account_id", params.accountId);
  } else {
    query = query.eq("account_id", params.accountId);
  }

  const { data, error } = await query.maybeSingle();
  if (error) {
    throw new Error(`Falha ao verificar agendamento duplicado: ${error.message}`);
  }

  return data;
}

export async function filterDuplicateScheduleRows<
  T extends {
    platform: "instagram" | "tiktok";
    account_id: string | null;
    tiktok_account_id: string | null;
    media_urls: string[];
  },
>(supabase: AdminClient, rows: T[]) {
  const accepted: T[] = [];
  const skipped: Array<{ media_url: string; existing_id: string }> = [];

  for (const row of rows) {
    const accountId =
      row.platform === "tiktok" ? row.tiktok_account_id : row.account_id;
    const mediaUrl = row.media_urls[0];

    if (!accountId || !mediaUrl) {
      accepted.push(row);
      continue;
    }

    const existing = await findPendingPostByMediaUrl(supabase, {
      platform: row.platform,
      accountId,
      mediaUrl,
    });

    if (existing) {
      skipped.push({ media_url: mediaUrl, existing_id: existing.id });
      continue;
    }

    accepted.push(row);
  }

  return { accepted, skipped };
}
