import type { SupabaseClient } from "@supabase/supabase-js";
import { getPlatformAdminHubUsername } from "@/lib/admin/gate";

function parseAdminOwnerIds(): string[] {
  const raw = process.env.PLATFORM_ADMIN_OWNER_IDS?.trim();
  if (!raw) return [];
  return raw
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
}

export async function resolvePlatformAdminOwnerId(supabase: SupabaseClient) {
  const allowlist = parseAdminOwnerIds();
  if (allowlist.length > 0) {
    return allowlist[0];
  }

  const hub = getPlatformAdminHubUsername();

  const { data, error } = await supabase
    .from("instagram_accounts")
    .select("owner_id, user_id, ig_username")
    .ilike("ig_username", `%${hub}%`)
    .limit(5);

  if (error) {
    console.error("[resolvePlatformAdminOwnerId]", error.message);
    return null;
  }

  const normalizedHub = hub.toLowerCase();
  const match = (data ?? []).find((row) => {
    const u = (row.ig_username ?? "").replace(/^@/, "").toLowerCase();
    return u === normalizedHub || u.includes(normalizedHub);
  });

  if (!match) return null;
  return (match.owner_id as string | null) ?? (match.user_id as string | null) ?? null;
}
