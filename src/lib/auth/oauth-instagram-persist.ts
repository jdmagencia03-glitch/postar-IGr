import type { SupabaseClient } from "@supabase/supabase-js";
import type { NextRequest } from "next/server";
import { randomUUID } from "crypto";
import { parseSignedSession } from "@/lib/auth/session-crypto";
import { SESSION_COOKIE } from "@/lib/auth/session-core";
import {
  encryptPageAccessToken,
  encryptSessionAccessToken,
} from "@/lib/security/tokens";
import { withHardTimeout } from "@/lib/with-timeout";
import { upsertAppSessionRow } from "@/lib/auth/oauth-callback-persist";

export const OAUTH_OWNER_LOOKUP_MS = 8_000;

type InstagramProfile = {
  id: string;
  username: string;
  profile_picture_url?: string;
};

export async function findInstagramAccountOwner(
  supabase: SupabaseClient,
  igUserId: string,
): Promise<string | null> {
  return withHardTimeout(
    (async () => {
      const { data } = await supabase
        .from("instagram_accounts")
        .select("owner_id, user_id")
        .eq("ig_user_id", igUserId)
        .maybeSingle();
      return data?.owner_id ?? data?.user_id ?? null;
    })(),
    OAUTH_OWNER_LOOKUP_MS,
    null,
    "oauth-find-ig-owner",
  );
}

export function resolveOAuthOwnerIdForLogin(
  request: NextRequest,
  options: { existingOwnerId: string | null; addAccount: boolean },
): { ownerId: string } | { error: "session_required" } {
  if (options.existingOwnerId) {
    return { ownerId: options.existingOwnerId };
  }

  if (options.addAccount) {
    return { error: "session_required" };
  }

  const sessionToken = request.cookies.get(SESSION_COOKIE)?.value;
  const signedOwner = sessionToken ? parseSignedSession(sessionToken) : null;
  if (signedOwner) {
    return { ownerId: signedOwner };
  }

  return { ownerId: randomUUID() };
}

/** Atualiza conta existente sem trocar owner_id; insere só se for nova. */
export async function persistInstagramAccountTokens(
  supabase: SupabaseClient,
  ownerId: string,
  profile: InstagramProfile,
  longToken: string,
): Promise<string> {
  const { data: existing } = await supabase
    .from("instagram_accounts")
    .select("owner_id, user_id")
    .eq("ig_user_id", profile.id)
    .maybeSingle();

  const effectiveOwnerId = existing?.owner_id ?? existing?.user_id ?? ownerId;
  const encryptedToken = encryptPageAccessToken(longToken);
  const now = new Date().toISOString();

  if (existing) {
    const { error } = await supabase
      .from("instagram_accounts")
      .update({
        ig_username: profile.username,
        page_access_token: encryptedToken,
        profile_picture_url: profile.profile_picture_url ?? null,
        updated_at: now,
      })
      .eq("ig_user_id", profile.id);
    if (error) throw new Error(error.message);
  } else {
    const { error } = await supabase.from("instagram_accounts").insert({
      owner_id: ownerId,
      user_id: ownerId,
      ig_user_id: profile.id,
      ig_username: profile.username,
      page_id: profile.id,
      page_access_token: encryptedToken,
      profile_picture_url: profile.profile_picture_url ?? null,
      auth_provider: "instagram",
      warmup_enabled: true,
      warmup_days: 5,
      updated_at: now,
    });
    if (error) throw new Error(error.message);
  }

  void supabase
    .from("instagram_accounts")
    .update({ warmup_started_at: now })
    .eq("ig_user_id", profile.id)
    .is("warmup_started_at", null);

  return effectiveOwnerId;
}

export function scheduleInstagramOAuthPersistence(
  supabase: SupabaseClient,
  params: {
    ownerId: string;
    sessionToken: string;
    longToken: string;
    profile: InstagramProfile;
    label: string;
  },
) {
  void (async () => {
    const effectiveOwnerId = await persistInstagramAccountTokens(
      supabase,
      params.ownerId,
      params.profile,
      params.longToken,
    );

    await upsertAppSessionRow(supabase, {
      ownerId: effectiveOwnerId,
      sessionToken: params.sessionToken,
      encryptedAccessToken: encryptSessionAccessToken(params.longToken),
      label: params.label,
    });
  })().catch((error) => {
    console.warn("[oauth-instagram-persist-failed]", {
      label: params.label,
      error: error instanceof Error ? error.message : String(error),
    });
  });
}
