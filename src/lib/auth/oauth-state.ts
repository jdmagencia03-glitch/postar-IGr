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

/** Valida state — cookie preferido; fallback sem cookie para AdsPower/navegadores embutidos. */
export async function validateOAuthCallbackState(params: {
  state: string;
  cookieState?: string;
  cookieNextPath?: string;
  defaultNextPath: string;
  label: string;
}): Promise<OAuthStateValidation> {
  const nextPath = sanitizeNextPath(params.cookieNextPath, params.defaultNextPath);
  const cookieMatch = Boolean(params.cookieState && params.cookieState === params.state);

  if (!cookieMatch) {
    const stateLooksValid = /^[a-f0-9]{32}$/i.test(params.state);
    if (!stateLooksValid) {
      return { valid: false, nextPath: params.defaultNextPath, source: "none" };
    }
    console.warn("[oauth-state-cookieless-fallback]", { label: params.label });
    return { valid: true, nextPath, source: "cookie" };
  }

  const supabase = createAdminClient();
  void withHardTimeout(
    (async () => {
      await supabase.from("oauth_states").delete().eq("state", params.state);
    })(),
    2_000,
    null,
    `${params.label}-cleanup`,
  ).catch(() => undefined);

  return { valid: true, nextPath, source: "cookie" };
}
