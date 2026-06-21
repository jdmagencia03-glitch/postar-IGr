import type { SupabaseClient } from "@supabase/supabase-js";
import { ownerAccountsFilter } from "@/lib/accounts";
import { validateVideoMediaUrl } from "@/lib/storage/media-url-validation";

export type MediaIntegrityAccountReport = {
  ownerId: string;
  account: string;
  accountId: string;
  platform: "instagram" | "tiktok";
  totalPostsChecked: number;
  validMedia: number;
  missingMedia: number;
  invalidContentType: number;
  zeroByteFiles: number;
  missingPosts: Array<{
    postId: string;
    status: string;
    videoUrl: string | null;
    code: string;
    scheduledAt: string;
  }>;
};

function accountLabel(username: string | null, id: string) {
  if (!username) return `@${id.slice(0, 8)}`;
  return username.startsWith("@") ? username : `@${username}`;
}

async function loadTargetAccounts(params: {
  supabase: SupabaseClient;
  scope: "platform" | "owner" | "account";
  ownerId?: string | null;
  accountId?: string | null;
}) {
  if (params.scope === "account" && params.ownerId && params.accountId) {
    const { data } = await params.supabase
      .from("instagram_accounts")
      .select("id, owner_id, user_id, ig_username")
      .eq("id", params.accountId)
      .or(ownerAccountsFilter(params.ownerId))
      .maybeSingle();

    if (!data) return [];
    return [
      {
        ownerId: (data.owner_id as string) ?? (data.user_id as string),
        accountId: data.id as string,
        platform: "instagram" as const,
        username: data.ig_username as string | null,
      },
    ];
  }

  if (params.scope === "owner" && params.ownerId) {
    const { data: ig } = await params.supabase
      .from("instagram_accounts")
      .select("id, owner_id, user_id, ig_username")
      .or(ownerAccountsFilter(params.ownerId));

    return (ig ?? []).map((row) => ({
      ownerId: (row.owner_id as string) ?? (row.user_id as string),
      accountId: row.id as string,
      platform: "instagram" as const,
      username: row.ig_username as string | null,
    }));
  }

  const { data: ig } = await params.supabase
    .from("instagram_accounts")
    .select("id, owner_id, user_id, ig_username")
    .order("created_at", { ascending: false })
    .limit(500);

  return (ig ?? []).map((row) => ({
    ownerId: (row.owner_id as string) ?? (row.user_id as string),
    accountId: row.id as string,
    platform: "instagram" as const,
    username: row.ig_username as string | null,
  }));
}

export async function buildMediaIntegrityAudit(params: {
  supabase: SupabaseClient;
  scope: "platform" | "owner" | "account";
  ownerId?: string | null;
  accountId?: string | null;
  includePending?: boolean;
  includeFailed?: boolean;
  includePublished?: boolean;
}) {
  const accounts = await loadTargetAccounts(params);
  const statuses: string[] = [];

  if (params.includePending !== false) {
    statuses.push("pending", "retrying", "processing", "needs_media");
  }
  if (params.includeFailed !== false) {
    statuses.push("failed", "failed_persistent");
  }
  if (params.includePublished) {
    statuses.push("published");
  }

  const uniqueStatuses = [...new Set(statuses)];
  const reports: MediaIntegrityAccountReport[] = [];

  for (const account of accounts) {
    const { data: posts } = await params.supabase
      .from("scheduled_posts")
      .select("id, status, media_urls, scheduled_at")
      .eq("account_id", account.accountId)
      .in("status", uniqueStatuses)
      .order("scheduled_at", { ascending: false })
      .limit(500);

    let validMedia = 0;
    let missingMedia = 0;
    let invalidContentType = 0;
    let zeroByteFiles = 0;
    const missingPosts: MediaIntegrityAccountReport["missingPosts"] = [];

    for (const post of posts ?? []) {
      const videoUrl = post.media_urls?.[0] ?? null;
      if (!videoUrl || !/\.(mp4|mov|webm)(\?|$)/i.test(videoUrl)) {
        continue;
      }

      const validation = await validateVideoMediaUrl({
        supabase: params.supabase,
        videoUrl,
        checkStorage: true,
      });

      if (validation.ok) {
        validMedia += 1;
        continue;
      }

      if (validation.code === "video_storage_object_missing") missingMedia += 1;
      else if (validation.code === "video_invalid_content_type") invalidContentType += 1;
      else if (validation.code === "video_zero_bytes") zeroByteFiles += 1;
      else missingMedia += 1;

      missingPosts.push({
        postId: post.id,
        status: post.status,
        videoUrl,
        code: validation.code,
        scheduledAt: post.scheduled_at,
      });
    }

    reports.push({
      ownerId: account.ownerId,
      account: accountLabel(account.username, account.accountId),
      accountId: account.accountId,
      platform: account.platform,
      totalPostsChecked: (posts ?? []).filter((p) => p.media_urls?.[0]).length,
      validMedia,
      missingMedia,
      invalidContentType,
      zeroByteFiles,
      missingPosts,
    });
  }

  return {
    ok: true as const,
    scope: params.scope,
    checkedAccounts: reports.length,
    totals: {
      totalPostsChecked: reports.reduce((s, r) => s + r.totalPostsChecked, 0),
      validMedia: reports.reduce((s, r) => s + r.validMedia, 0),
      missingMedia: reports.reduce((s, r) => s + r.missingMedia, 0),
      invalidContentType: reports.reduce((s, r) => s + r.invalidContentType, 0),
      zeroByteFiles: reports.reduce((s, r) => s + r.zeroByteFiles, 0),
    },
    accounts: reports,
  };
}
