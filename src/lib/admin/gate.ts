import type { SupabaseClient } from "@supabase/supabase-js";
import { getOwnerAccountRefs } from "@/lib/posts";

const DEFAULT_HUB_IG = "deolhonoshape3s";

function parseAdminOwnerIds(): Set<string> {
  const raw = process.env.PLATFORM_ADMIN_OWNER_IDS?.trim();
  if (!raw) return new Set();
  return new Set(
    raw
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean),
  );
}

export function getPlatformAdminHubUsername() {
  return (process.env.PLATFORM_ADMIN_HUB_IG ?? DEFAULT_HUB_IG).replace(/^@/, "").toLowerCase();
}

export async function isPlatformAdmin(
  supabase: SupabaseClient,
  ownerId: string | null | undefined,
): Promise<boolean> {
  if (!ownerId) return false;

  const allowlist = parseAdminOwnerIds();
  if (allowlist.has(ownerId)) return true;

  const hubUsername = getPlatformAdminHubUsername();
  const refs = await getOwnerAccountRefs(supabase, ownerId);
  return refs.some(
    (ref) =>
      ref.platform === "instagram" &&
      (ref.username ?? "").replace(/^@/, "").toLowerCase() === hubUsername,
  );
}

export async function requirePlatformAdmin(
  supabase: SupabaseClient,
  ownerId: string | null | undefined,
) {
  const allowed = await isPlatformAdmin(supabase, ownerId);
  if (!allowed) {
    return { ok: false as const, error: "Acesso restrito ao painel de diagnóstico admin." };
  }
  return { ok: true as const };
}
