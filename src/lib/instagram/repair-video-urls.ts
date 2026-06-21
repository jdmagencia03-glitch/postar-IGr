import type { SupabaseClient } from "@supabase/supabase-js";
import { buildInstagramVideoUrlAudit } from "@/lib/instagram/video-url-audit";
import { probeHttpMediaUrl } from "@/lib/storage/media-url-validation";

export type VideoUrlRepairAction = {
  postId: string;
  oldVideoUrl: string;
  newVideoUrl: string;
  newUrlHttpStatus: number | null;
  newUrlContentType: string | null;
  action: "update_video_url";
  alternatePath: string;
};

export type UnrepairablePost = {
  postId: string;
  reason: string;
  recommendation: string;
  videoUrl: string;
  probableCause: string;
};

export async function buildInstagramVideoUrlRepairPlan(params: {
  supabase: SupabaseClient;
  ownerId: string;
  accountId: string;
  confirm: boolean;
}) {
  const audit = await buildInstagramVideoUrlAudit({
    supabase: params.supabase,
    ownerId: params.ownerId,
    accountId: params.accountId,
    limit: 100,
  });

  if (!audit.ok) {
    return audit;
  }

  const repairs: VideoUrlRepairAction[] = [];
  const unrepairable: UnrepairablePost[] = [];

  for (const item of audit.posts) {
    const bestAlternate = item.matchedAlternateObjects.find(
      (alt) => alt.httpStatus !== null && alt.httpStatus < 400 && alt.contentType?.includes("video/"),
    );

    if (bestAlternate) {
      repairs.push({
        postId: item.postId,
        oldVideoUrl: item.videoUrl,
        newVideoUrl: bestAlternate.publicUrl,
        newUrlHttpStatus: bestAlternate.httpStatus,
        newUrlContentType: bestAlternate.contentType,
        action: "update_video_url",
        alternatePath: bestAlternate.path,
      });
      continue;
    }

    unrepairable.push({
      postId: item.postId,
      reason: item.probableCause,
      recommendation: "Reupload/reprocess media for this post before retry.",
      videoUrl: item.videoUrl,
      probableCause: item.probableCause,
    });
  }

  if (!params.confirm) {
    return {
      ok: true as const,
      dryRun: true as const,
      repairablePosts: repairs.length,
      unrepairablePosts: unrepairable.length,
      repairs,
      unrepairable,
      auditSummary: audit.summary,
    };
  }

  const applied: VideoUrlRepairAction[] = [];
  const failed: Array<{ postId: string; error: string }> = [];

  for (const repair of repairs) {
    const verify = await probeHttpMediaUrl(repair.newVideoUrl);
    if (!verify.accessible) {
      failed.push({
        postId: repair.postId,
        error: "Alternate URL failed validation at apply time",
      });
      continue;
    }

    const { error } = await params.supabase
      .from("scheduled_posts")
      .update({
        media_urls: [repair.newVideoUrl],
        updated_at: new Date().toISOString(),
      })
      .eq("id", repair.postId)
      .eq("account_id", params.accountId);

    if (error) {
      failed.push({ postId: repair.postId, error: error.message });
      continue;
    }

    applied.push(repair);
  }

  return {
    ok: true as const,
    dryRun: false as const,
    repairablePosts: repairs.length,
    unrepairablePosts: unrepairable.length,
    appliedCount: applied.length,
    failedCount: failed.length,
    repairs: applied,
    unrepairable,
    failed,
    message:
      "Somente media_urls atualizado. scheduled_at, error_message e retry_count preservados.",
  };
}
