import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { withHardTimeout, DB_ROUTE_TIMEOUT_MS } from "@/lib/with-timeout";

const INSERT_TIMEOUT_SENTINEL = "__oauth_state_insert_timeout__";

function sanitizeNextPath(value: string | null | undefined, fallback: string) {
  if (!value || !value.startsWith("/") || value.startsWith("//")) {
    return fallback;
  }
  return value;
}

/** Tenta persistir state no banco; se falhar, cookies httpOnly já carregam state/next. */
export async function persistOAuthStateRow(
  supabase: SupabaseClient,
  state: string,
  nextPath: string,
  label: string,
): Promise<void> {
  const result = await withHardTimeout(
    (async () => {
      const { error } = await supabase.from("oauth_states").insert({ state, next_path: nextPath });
      return { error: error?.message ?? null };
    })(),
    DB_ROUTE_TIMEOUT_MS,
    { error: INSERT_TIMEOUT_SENTINEL },
    label,
  );

  if (!result.error) return;

  console.warn("[oauth-state-cookie-fallback-start]", {
    label,
    error: result.error === INSERT_TIMEOUT_SENTINEL ? "db_timeout" : result.error,
  });
}

export type OAuthStateValidation = {
  valid: boolean;
  nextPath: string;
  source: "db" | "cookie" | "none";
};

/** Valida state no callback — DB com timeout, fallback para cookies quando Supabase lento. */
export async function validateOAuthCallbackState(params: {
  state: string;
  cookieState?: string;
  cookieNextPath?: string;
  defaultNextPath: string;
  label: string;
}): Promise<OAuthStateValidation> {
  const cookieMatch = Boolean(params.cookieState && params.cookieState === params.state);
  if (!cookieMatch) {
    return { valid: false, nextPath: params.defaultNextPath, source: "none" };
  }

  const supabase = createAdminClient();
  const dbRow = await withHardTimeout(
    (async () => {
      const { data } = await supabase
        .from("oauth_states")
        .select("next_path")
        .eq("state", params.state)
        .maybeSingle();
      return data;
    })(),
    DB_ROUTE_TIMEOUT_MS,
    null,
    `${params.label}-lookup`,
  );

  if (dbRow) {
    void supabase.from("oauth_states").delete().eq("state", params.state);
    return {
      valid: true,
      nextPath: sanitizeNextPath(dbRow.next_path, params.defaultNextPath),
      source: "db",
    };
  }

  if (params.cookieNextPath) {
    console.info("[oauth-state-cookie-fallback]", { label: params.label });
    return {
      valid: true,
      nextPath: sanitizeNextPath(params.cookieNextPath, params.defaultNextPath),
      source: "cookie",
    };
  }

  return { valid: false, nextPath: params.defaultNextPath, source: "none" };
}
