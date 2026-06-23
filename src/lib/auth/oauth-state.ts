import type { SupabaseClient } from "@supabase/supabase-js";
import { withHardTimeout, DB_ROUTE_TIMEOUT_MS } from "@/lib/with-timeout";

const INSERT_TIMEOUT_SENTINEL = "__oauth_state_insert_timeout__";

/** Persiste state OAuth com timeout — evita travar o clique em "Conectar". */
export async function insertOAuthStateRow(
  supabase: SupabaseClient,
  state: string,
  nextPath: string,
  label: string,
): Promise<boolean> {
  const result = await withHardTimeout(
    (async () => {
      const { error } = await supabase.from("oauth_states").insert({ state, next_path: nextPath });
      return { error: error?.message ?? null };
    })(),
    DB_ROUTE_TIMEOUT_MS,
    { error: INSERT_TIMEOUT_SENTINEL },
    label,
  );

  if (!result.error || result.error === INSERT_TIMEOUT_SENTINEL) {
    if (result.error === INSERT_TIMEOUT_SENTINEL) {
      console.error("[oauth-state-insert-failed]", { label, error: "db_timeout" });
      return false;
    }
    return true;
  }

  console.error("[oauth-state-insert-failed]", { label, error: result.error });
  return false;
}

export function oauthUnavailableRedirect(requestUrl: string) {
  const url = new URL("/login", requestUrl);
  url.searchParams.set("error", "oauth_unavailable");
  return url;
}
