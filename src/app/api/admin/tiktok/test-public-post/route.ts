import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requirePlatformAdmin } from "@/lib/admin/gate";
import { formatZodError } from "@/lib/api-errors";
import { getSessionUserId } from "@/lib/meta/oauth";
import { logPublishEvent, markPostFailed, markPostPublished } from "@/lib/publish/cron";
import { createAdminClient } from "@/lib/supabase/admin";
import { getOwnerTikTokAccountById } from "@/lib/tiktok/accounts";
import { buildTikTokPublishDiagnostics } from "@/lib/tiktok/publish-diagnostics";
import { publishTikTokPost, isTikTokPublishError } from "@/lib/tiktok/publish";
import { wouldUsePublicPrivacyLevel } from "@/lib/tiktok/public-posting";
import { logSecurityEvent } from "@/lib/security/audit";

export const maxDuration = 300;

const bodySchema = z.object({
  accountId: z.string().uuid(),
  postId: z.string().uuid(),
  confirm: z.boolean().optional().default(false),
});

/**
 * Teste manual de 1 post TikTok com PUBLIC_TO_EVERYONE (admin).
 * Só publica se creator_info incluir PUBLIC_TO_EVERYONE em privacy_level_options.
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

  const diagnostics = await buildTikTokPublishDiagnostics({
    supabase,
    account,
    sampleVideoUrl: post.media_urls?.[0] ?? null,
  });

  const wouldUsePrivacyLevel = diagnostics.canPublicPostNow
    ? "PUBLIC_TO_EVERYONE"
    : wouldUsePublicPrivacyLevel({
        privacyLevelOptions: diagnostics.privacyLevelOptions,
        lastTikTokError: diagnostics.lastTikTokError,
        publicPostingEnabled: diagnostics.publicPostingEnabled,
        directPostAuditApproved: diagnostics.directPostAuditApproved,
      });

  if (!parsed.data.confirm) {
    return NextResponse.json({
      ok: true,
      dryRun: true,
      wouldUsePrivacyLevel,
      canPublicPostNow: diagnostics.canPublicPostNow,
      directPostAuditApproved: diagnostics.directPostAuditApproved,
      lastTikTokPublicPostError: diagnostics.lastTikTokPublicPostError,
      hasPublicToEveryone: diagnostics.hasPublicToEveryone,
      accountAppearsPrivate: diagnostics.accountAppearsPrivate,
      publicPostBlockReason: diagnostics.publicPostBlockReason,
      privacyLevelOptions: diagnostics.privacyLevelOptions,
      uploadMethod: diagnostics.uploadMethod,
      diagnostics,
    });
  }

  if (!diagnostics.canPublicPostNow || !diagnostics.hasPublicToEveryone) {
    return NextResponse.json(
      {
        ok: false,
        error: "public_post_not_allowed",
        publicPostBlockReason: diagnostics.publicPostBlockReason,
        privacyLevelOptions: diagnostics.privacyLevelOptions,
        diagnostics,
      },
      { status: 409 },
    );
  }

  if (!diagnostics.tokenValid || !diagnostics.scopesOk) {
    return NextResponse.json(
      {
        ok: false,
        error: "account_not_ready",
        publicPostBlockReason: diagnostics.publicPostBlockReason,
        diagnostics,
      },
      { status: 409 },
    );
  }

  await logPublishEvent(
    supabase,
    post.id,
    "info",
    "Teste manual admin PUBLIC_TO_EVERYONE iniciado",
  );

  try {
    const result = await publishTikTokPost({
      account,
      mediaUrls: post.media_urls ?? [],
      caption: post.caption ?? undefined,
      existingPublishId: post.provider_publish_id,
      postId: post.id,
      privacyLevel: "PUBLIC_TO_EVERYONE",
      publishMode: "admin_test",
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
      `Teste manual público OK (${result.uploadMethod}, ${result.privacyLevel}): ${result.permalink ?? result.postId}`,
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
        adminManualPublicTest: true,
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
    const message = error instanceof Error ? error.message : "Falha na publicação TikTok pública";
    const logMessage = isTikTokPublishError(error) ? error.logMessage : message;

    await markPostFailed(supabase, post.id, message);
    await logPublishEvent(supabase, post.id, "error", logMessage);

    return NextResponse.json(
      {
        ok: false,
        error: "publish_failed",
        message,
        logMessage,
        diagnostics,
        ...(isTikTokPublishError(error) && error.chunkPlan
          ? { chunkPlan: error.chunkPlan, chunkPlanLog: error.chunkPlanLog }
          : {}),
      },
      { status: 500 },
    );
  }
}
