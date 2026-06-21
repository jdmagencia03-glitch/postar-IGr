import type { SupabaseClient } from "@supabase/supabase-js";
import {
  getOwnerTikTokAccountById,
  markTikTokAccountStatus,
  getValidTikTokAccessToken,
} from "@/lib/tiktok/accounts";
import {
  hasRequiredPublishScopes,
  queryCreatorInfo,
  queryCreatorInfoForAccount,
} from "@/lib/tiktok/creator";
import type { PermissionCheckItem, PermissionValidationResult } from "@/lib/operations/validate-permissions";
import type { TikTokAccount, TikTokCreatorValidation } from "@/lib/types";

function level(ok: boolean, warn = false) {
  if (ok) return "ok" as const;
  if (warn) return "attention" as const;
  return "error" as const;
}

export async function validateTikTokConnection(
  supabase: SupabaseClient,
  ownerId: string,
  accountId: string,
  options: { persist?: boolean } = {},
): Promise<PermissionValidationResult & { creator?: TikTokCreatorValidation | null }> {
  const checkedAt = new Date().toISOString();
  const account = await getOwnerTikTokAccountById(supabase, ownerId, accountId);

  if (!account) {
    return {
      overall: "error",
      summary: "Conta TikTok não encontrada.",
      checks: [],
      platform: "tiktok",
      accountId,
      username: null,
      checkedAt,
      creator: null,
    };
  }

  const checks: PermissionCheckItem[] = [];
  let creator: TikTokCreatorValidation | null = null;
  let validationError: string | null = null;

  if (account.status === "error") {
    checks.push({
      key: "account_status",
      label: "Status da conta",
      level: "error",
      message: account.last_validation_error ?? "Conta com erro — reconecte",
    });
  }

  if (account.publishing_paused) {
    checks.push({
      key: "paused",
      label: "Publicações",
      level: "attention",
      message: "Conta pausada — cron não publicará até retomar",
    });
  }

  const hasScopes = hasRequiredPublishScopes(account.scopes);
  checks.push({
    key: "scopes",
    label: "Permissões",
    level: level(hasScopes, !hasScopes),
    message: hasScopes
      ? `Scopes: ${account.scopes}`
      : "Permissão video.publish ou video.upload não encontrada",
  });

  try {
    const accessToken = await getValidTikTokAccessToken(supabase, account);
    checks.push({
      key: "token",
      label: "Token",
      level: "ok",
      message: "Token válido (renovado automaticamente se necessário)",
    });

    const creatorInfo = await queryCreatorInfo(accessToken);
    if (!creatorInfo) {
      throw new Error("creator_info vazio — verifique scope video.publish");
    }

    creator = {
      username: creatorInfo.creator_username ?? account.username,
      nickname: creatorInfo.creator_nickname ?? account.display_name,
      avatar_url: creatorInfo.creator_avatar_url ?? account.profile_picture_url,
      max_video_post_duration_sec: creatorInfo.max_video_post_duration_sec ?? null,
      privacy_level_options: creatorInfo.privacy_level_options ?? [],
      comment_disabled: creatorInfo.comment_disabled ?? false,
      duet_disabled: creatorInfo.duet_disabled ?? false,
      stitch_disabled: creatorInfo.stitch_disabled ?? false,
    };

    checks.push({
      key: "creator",
      label: "Creator Info",
      level: "ok",
      message: `@${creator.username ?? "conta"} pode publicar via Direct Post${
        creator.privacy_level_options?.length
          ? ` · Privacidade: ${creator.privacy_level_options.join(", ")}`
          : ""
      }`,
    });

    if (creator.max_video_post_duration_sec) {
      checks.push({
        key: "duration",
        label: "Duração máxima",
        level: "ok",
        message: `Até ${creator.max_video_post_duration_sec}s por vídeo`,
      });
    }

    if (options.persist) {
      await markTikTokAccountStatus(supabase, account.id, {
        status: "active",
        last_validated_at: checkedAt,
        last_validation_error: null,
        creator_max_duration_sec: creator.max_video_post_duration_sec ?? null,
        creator_username: creator.username ?? null,
        display_name: creator.nickname ?? account.display_name,
        profile_picture_url: creator.avatar_url ?? account.profile_picture_url,
      });
    }
  } catch (error) {
    validationError = error instanceof Error ? error.message : "Falha na validação TikTok";
    const needsReconnect =
      validationError.includes("invalid") ||
      validationError.includes("expir") ||
      validationError.includes("Reconecte");

    checks.push({
      key: "token",
      label: "Token / API",
      level: "error",
      message: validationError,
    });

    if (options.persist) {
      await markTikTokAccountStatus(supabase, account.id, {
        status: needsReconnect ? "error" : account.status ?? "active",
        last_validated_at: checkedAt,
        last_validation_error: validationError,
      });
    }
  }

  const overall = checks.some((c) => c.level === "error")
    ? "error"
    : checks.some((c) => c.level === "attention")
      ? "attention"
      : "ok";

  return {
    overall,
    summary:
      overall === "ok"
        ? "Conta validada com sucesso. Publicação liberada."
        : overall === "attention"
          ? "Conta conectada, mas há pontos de atenção."
          : validationError?.includes("Reconecte")
            ? "Token expirado — reconecte a conta TikTok."
            : "Erro na validação — reconecte ou revise permissões.",
    checks,
    platform: "tiktok",
    accountId,
    username: account.username ?? account.display_name,
    checkedAt,
    creator,
  };
}

export async function refreshCreatorInfoForAccount(
  supabase: SupabaseClient,
  account: TikTokAccount,
) {
  const creatorInfo = await queryCreatorInfoForAccount(supabase, account);
  return creatorInfo;
}
