import { getOwnerAccountById, getAccountAccessToken } from "@/lib/accounts";
import { checkInstagramAccountHealth } from "@/lib/meta/instagram";
import { getOwnerTikTokAccountById } from "@/lib/tiktok/accounts";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { SocialPlatform } from "@/lib/types";

export type PermissionCheckLevel = "ok" | "attention" | "error";

export interface PermissionCheckItem {
  key: string;
  label: string;
  level: PermissionCheckLevel;
  message: string;
}

export interface PermissionValidationResult {
  overall: PermissionCheckLevel;
  summary: string;
  checks: PermissionCheckItem[];
  platform: SocialPlatform;
  accountId: string;
  username: string | null;
  checkedAt: string;
}

function levelFromBoolean(ok: boolean, warn = false): PermissionCheckLevel {
  if (ok) return "ok";
  if (warn) return "attention";
  return "error";
}

export async function validateAccountPermissions(
  supabase: SupabaseClient,
  ownerId: string,
  accountId: string,
  platform: SocialPlatform,
): Promise<PermissionValidationResult> {
  const checks: PermissionCheckItem[] = [];
  const checkedAt = new Date().toISOString();

  if (platform === "tiktok") {
    const account = await getOwnerTikTokAccountById(supabase, ownerId, accountId);
    if (!account) {
      return {
        overall: "error",
        summary: "Conta TikTok não encontrada.",
        checks: [],
        platform,
        accountId,
        username: null,
        checkedAt,
      };
    }

    const tokenValid =
      account.token_expires_at && new Date(account.token_expires_at).getTime() > Date.now();

    checks.push({
      key: "token",
      label: "Token",
      level: levelFromBoolean(Boolean(tokenValid)),
      message: tokenValid ? "Token válido" : "Token expirado — reconecte a conta",
    });

    checks.push({
      key: "publish",
      label: "Publicação",
      level: tokenValid ? "ok" : "error",
      message: tokenValid
        ? "Integração TikTok conectada para publicação"
        : "Reconecte para publicar vídeos",
    });

    if (account.scopes) {
      const hasPublish = account.scopes.includes("video.publish") || account.scopes.includes("video.upload");
      checks.push({
        key: "scopes",
        label: "Permissões",
        level: levelFromBoolean(hasPublish, !hasPublish),
        message: hasPublish
          ? `Scopes: ${account.scopes}`
          : "Permissão de publicação de vídeo não confirmada nos scopes",
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
            : "Erro na validação — reconecte ou revise permissões.",
      checks,
      platform,
      accountId,
      username: account.username ?? account.display_name,
      checkedAt,
    };
  }

  const account = await getOwnerAccountById(supabase, ownerId, accountId);
  if (!account) {
    return {
      overall: "error",
      summary: "Conta Instagram não encontrada.",
      checks: [],
      platform: "instagram",
      accountId,
      username: null,
      checkedAt,
    };
  }

  const accessToken = getAccountAccessToken(account);
  const provider = account.auth_provider === "facebook" ? "facebook" : "instagram";

  if (!accessToken) {
    checks.push({
      key: "token",
      label: "Token",
      level: "error",
      message: "Token ausente — reconecte a conta",
    });
  } else {
    const health = await checkInstagramAccountHealth(accessToken, {
      provider,
      igUserId: account.ig_user_id,
    });

    checks.push({
      key: "token",
      label: "Token",
      level: health.status === "active" ? "ok" : "error",
      message: health.message,
    });

    checks.push({
      key: "account",
      label: "Conta conectada",
      level: health.status === "active" ? "ok" : "error",
      message:
        health.status === "active"
          ? `@${account.ig_username ?? "conta"} operacional`
          : "Falha ao validar conta no Instagram/Meta",
    });
  }

  checks.push({
    key: "page",
    label: "Página Facebook",
    level: provider === "facebook" && account.page_id ? "ok" : provider === "facebook" ? "attention" : "attention",
    message:
      provider === "facebook" && account.page_id
        ? "Página vinculada via Facebook Login"
        : "Login direto Instagram — verifique permissões de publicação no Meta",
  });

  checks.push({
    key: "publish",
    label: "Publicação Reels",
    level: checks.find((c) => c.key === "token")?.level === "ok" ? "ok" : "error",
    message:
      checks.find((c) => c.key === "token")?.level === "ok"
        ? "Token válido para publicação de Reels"
        : "Token inválido — publicação bloqueada",
  });

  checks.push({
    key: "stories",
    label: "Stories",
    level: "attention",
    message:
      "Permissão de Stories depende do app Meta. Reels podem funcionar mesmo se Stories automáticos estiverem bloqueados.",
  });

  if (account.publishing_paused) {
    checks.push({
      key: "paused",
      label: "Publicações",
      level: "attention",
      message: "Conta pausada — cron não publicará até retomar",
    });
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
          ? "Conta operacional com ressalvas — revise Stories ou pausa."
          : "Erro na validação — reconecte a conta.",
    checks,
    platform: "instagram",
    accountId,
    username: account.ig_username,
    checkedAt,
  };
}
