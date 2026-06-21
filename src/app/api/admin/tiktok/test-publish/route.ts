import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requirePlatformAdmin } from "@/lib/admin/gate";
import { formatZodError } from "@/lib/api-errors";
import { getSessionUserId } from "@/lib/meta/oauth";
import { logPublishEvent, markPostFailed, markPostPublished } from "@/lib/publish/cron";
import { createAdminClient } from "@/lib/supabase/admin";
import { getOwnerTikTokAccountById, getValidTikTokAccessToken } from "@/lib/tiktok/accounts";
import { formatCreatorInfoLog, queryCreatorInfo } from "@/lib/tiktok/creator";
import { computeTikTokChunks, probeVideoForTikTokUpload } from "@/lib/tiktok/file-upload";
import { buildTikTokPublishDiagnostics } from "@/lib/tiktok/publish-diagnostics";
import { publishTikTokPost, isTikTokPublishError } from "@/lib/tiktok/publish";
import {
  isTikTokUnauditedClientError,
  TIKTOK_UNAUDITED_CLIENT_NEXT_STEPS,
} from "@/lib/tiktok/upload-config";
import { logSecurityEvent } from "@/lib/security/audit";

export const maxDuration = 300;

const privacyLevelSchema = z.enum([
  "SELF_ONLY",
  "MUTUAL_FOLLOW_FRIENDS",
  "PUBLIC_TO_EVERYONE",
]);

const bodySchema = z.object({
  accountId: z.string().uuid(),
  postId: z.string().uuid(),
  confirm: z.boolean().optional().default(false),
  privacyLevel: privacyLevelSchema.optional().default("SELF_ONLY"),
});

/**
 * Publica exatamente 1 post TikTok (admin). Não despausa a conta.
 * confirm: false → dry-run (plano de chunks + creator info, sem chamar TikTok init).
 * confirm: true → publicação real de 1 post (privacyLevel padrão: SELF_ONLY).
 */
export async function POST(request: NextRequest) {
  const ownerId = await getSessionUserId();
  if (!ownerId) {
    return NextResponse.json({ ok: false, error: "unauthenticated" }, { status: 401 });
  }

  const supabase = createAdminClient();
  const gate = await requirePlatformAdmin(supabase, ownerId);
  if (!gate.ok) {
    return NextResponse.json({ ok: false, error: "forbidden", message: gate.error }, { status: 403 });
  }

  const raw = await request.json().catch(() => ({}));
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: formatZodError(parsed.error) }, { status: 400 });
  }

  const account = await getOwnerTikTokAccountById(supabase, ownerId, parsed.data.accountId);
  if (!account) {
    return NextResponse.json({ ok: false, error: "account_not_found" }, { status: 404 });
  }

  const { data: post, error: postError } = await supabase
    .from("scheduled_posts")
    .select("*")
    .eq("id", parsed.data.postId)
    .eq("platform", "tiktok")
    .eq("tiktok_account_id", parsed.data.accountId)
    .maybeSingle();

  if (postError || !post) {
    return NextResponse.json({ ok: false, error: "post_not_found" }, { status: 404 });
  }

  const videoUrl = post.media_urls?.[0] ?? null;
  if (!videoUrl) {
    return NextResponse.json({ ok: false, error: "missing_video_url" }, { status: 400 });
  }

  const diagnostics = await buildTikTokPublishDiagnostics({
    supabase,
    account,
    sampleVideoUrl: videoUrl,
  });

  let creatorInfo = diagnostics.creatorInfo;
  if (!creatorInfo) {
    try {
      const accessToken = await getValidTikTokAccessToken(supabase, account);
      const creator = await queryCreatorInfo(accessToken);
      if (creator) {
        creatorInfo = formatCreatorInfoLog(creator);
      }
    } catch {
      // dry-run segue sem creator info se token falhar
    }
  }

  if (!parsed.data.confirm) {
    try {
      const probe = await probeVideoForTikTokUpload(videoUrl);
      const chunkPlan = computeTikTokChunks(probe.videoSize);

      return NextResponse.json({
        ok: true,
        dryRun: true,
        videoUrl: probe.videoUrl,
        videoSize: probe.videoSize,
        mimeType: probe.mimeType,
        uploadMethod: "FILE_UPLOAD",
        privacyLevel: parsed.data.privacyLevel,
        creatorInfo,
        chunkPlan: {
          videoSize: chunkPlan.videoSize,
          chunkSize: chunkPlan.chunkSize,
          totalChunkCount: chunkPlan.totalChunkCount,
          chunks: chunkPlan.chunks,
        },
        diagnostics,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Falha no dry-run TikTok";
      return NextResponse.json({ ok: false, error: "dry_run_failed", message }, { status: 500 });
    }
  }

  if (!diagnostics.tokenValid || !diagnostics.scopesOk) {
    return NextResponse.json(
      {
        ok: false,
        error: "account_not_ready",
        diagnostics,
        message: diagnostics.recommendation,
      },
      { status: 409 },
    );
  }

  if (
    parsed.data.privacyLevel === "PUBLIC_TO_EVERYONE" &&
    !diagnostics.canPublicPostNow
  ) {
    return NextResponse.json(
      {
        ok: false,
        error: "public_post_not_allowed",
        publicPostBlockReason: diagnostics.publicPostBlockReason,
        privacyLevelOptions: diagnostics.privacyLevelOptions,
        diagnostics,
      },
      { status: 403 },
    );
  }

  await logPublishEvent(
    supabase,
    post.id,
    "info",
    `Teste manual admin iniciado (uploadMethod=${diagnostics.uploadMethod}, privacyLevel=${parsed.data.privacyLevel})`,
  );

  try {
    const result = await publishTikTokPost({
      account,
      mediaUrls: post.media_urls ?? [],
      caption: post.caption ?? undefined,
      existingPublishId: post.provider_publish_id,
      postId: post.id,
      privacyLevel: parsed.data.privacyLevel,
      publishMode: "admin_test",
      testMode: true,
    });

    await markPostPublished(supabase, post.id, {
      media_id: result.postId,
      permalink: result.permalink,
      provider_publish_id: result.publishId,
      provider_status: result.providerStatus,
      provider_response: result.providerResponse,
    });

    await logPublishEvent(
      supabase,
      post.id,
      "success",
      `Teste manual admin OK (${result.uploadMethod}, ${result.privacyLevel}): ${result.permalink ?? result.postId}`,
    );

    await logSecurityEvent({
      ownerId: account.owner_id,
      eventType: "tiktok_publish",
      resourceType: "scheduled_post",
      resourceId: post.id,
      metadata: {
        uploadMethod: result.uploadMethod,
        privacyLevel: result.privacyLevel,
        publishId: result.publishId,
        adminManualTest: true,
      },
    });

    return NextResponse.json({
      ok: true,
      published: true,
      postId: post.id,
      uploadMethod: result.uploadMethod,
      privacyLevel: result.privacyLevel,
      publishId: result.publishId,
      permalink: result.permalink,
      publishPaused: account.publishing_paused,
      diagnostics,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha na publicação TikTok";
    const logMessage = isTikTokPublishError(error) ? error.logMessage : message;

    await markPostFailed(supabase, post.id, message);
    await logPublishEvent(supabase, post.id, "error", logMessage);

    if (isTikTokUnauditedClientError(message)) {
      return NextResponse.json(
        {
          ok: false,
          error: "tiktok_app_unaudited_private_account_required",
          message:
            "O app TikTok ainda não foi auditado. Para testar, deixe a conta TikTok como privada ou envie o app para auditoria no TikTok Developers.",
          nextSteps: [...TIKTOK_UNAUDITED_CLIENT_NEXT_STEPS],
          logMessage,
          privacyLevel: parsed.data.privacyLevel,
          diagnostics,
          ...(isTikTokPublishError(error) && error.chunkPlan
            ? {
                chunkPlan: error.chunkPlan,
                chunkPlanLog: error.chunkPlanLog,
              }
            : {}),
        },
        { status: 403 },
      );
    }

    return NextResponse.json(
      {
        ok: false,
        error: "publish_failed",
        message,
        logMessage,
        privacyLevel: parsed.data.privacyLevel,
        diagnostics,
        ...(isTikTokPublishError(error) && error.chunkPlan
          ? {
              chunkPlan: error.chunkPlan,
              chunkPlanLog: error.chunkPlanLog,
            }
          : {}),
      },
      { status: 500 },
    );
  }
}
