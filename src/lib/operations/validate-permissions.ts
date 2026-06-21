import { getOwnerAccountById, getAccountAccessToken } from "@/lib/accounts";
import { checkInstagramAccountHealth } from "@/lib/meta/instagram";
import { validateTikTokConnection } from "@/lib/tiktok/validate";
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
    const result = await validateTikTokConnection(supabase, ownerId, accountId, {
      persist: true,
    });
    const { creator: _creator, ...rest } = result;
    return rest;
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
    level: provider === "facebook" && account.page_id ? "ok" : "ok",
    message:
      provider === "facebook" && account.page_id
        ? "Página vinculada via Facebook Login"
        : "Login direto Instagram — Reels e agendamento funcionam normalmente",
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
    level: "ok",
    message:
      "Reels e upload em massa OK. Stories automáticos dependem de permissão extra no app Meta (opcional).",
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
