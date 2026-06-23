import type { NextRequest } from "next/server";
import {
  exchangeCodeForToken,
  getInstagramProfile,
  getLongLivedToken,
} from "@/lib/meta/oauth";
import { validateOAuthCallbackState } from "@/lib/auth/oauth-state";
import { resolveOAuthCallbackSessionTokenFast } from "@/lib/auth/oauth-callback-persist";
import {
  findInstagramAccountOwner,
  persistInstagramAccountTokens,
  resolveOAuthOwnerIdForLogin,
} from "@/lib/auth/oauth-instagram-persist";
import { upsertAppSessionRow } from "@/lib/auth/oauth-callback-persist";
import { encryptSessionAccessToken } from "@/lib/security/tokens";
import { readOAuthAddAccountFlag } from "@/lib/auth/resolve-owner";
import { createAdminClient } from "@/lib/supabase/admin";
import { logSecurityEvent } from "@/lib/security/audit";
import { getClientIp } from "@/lib/security/rate-limit";
import { withHardTimeout } from "@/lib/with-timeout";
import { waitUntil } from "@vercel/functions";
import {
  classifyMetaOAuthError,
  logMetaOAuthError,
  type MetaOAuthErrorCode,
  userMessageForMetaOAuthError,
} from "@/lib/auth/meta-oauth-errors";

const TOKEN_EXCHANGE_MS = 25_000;
const PROFILE_FETCH_MS = 20_000;
const OWNER_LOOKUP_MS = 2_000;

export type MetaOAuthExchangeResult =
  | {
      ok: true;
      redirectTo: string;
      ownerId: string;
      sessionToken: string;
      sessionCreated: true;
      persistencePending: true;
    }
  | { ok: false; errorCode: MetaOAuthErrorCode; error: string; status: number };

function sanitizeNextPath(value: string | null | undefined) {
  if (!value || !value.startsWith("/") || value.startsWith("//")) {
    return "/dashboard";
  }
  return value;
}

function isProfessionalInstagramAccount(accountType?: string) {
  const normalized = accountType?.toUpperCase() ?? "";
  return normalized === "BUSINESS" || normalized === "MEDIA_CREATOR";
}

function fail(code: MetaOAuthErrorCode, status: number, detail?: string): MetaOAuthExchangeResult {
  logMetaOAuthError(code, detail);
  return { ok: false, errorCode: code, error: userMessageForMetaOAuthError(code), status };
}

export async function completeMetaOAuthExchange(
  request: NextRequest,
  params: { code: string; state: string; nextPath?: string | null },
): Promise<MetaOAuthExchangeResult> {
  const storedState = request.cookies.get("meta_oauth_state")?.value;
  const storedNext = request.cookies.get("meta_oauth_next")?.value;
  const fallbackNext = sanitizeNextPath(params.nextPath ?? storedNext);
  const addAccount = readOAuthAddAccountFlag(request);

  const oauthState = await validateOAuthCallbackState({
    state: params.state,
    cookieState: storedState,
    cookieNextPath: storedNext,
    defaultNextPath: fallbackNext,
    label: "oauth-meta-exchange",
  });

  if (!oauthState.valid) {
    void logSecurityEvent({
      eventType: "login_failed",
      ipAddress: getClientIp(request),
      userAgent: request.headers.get("user-agent"),
      metadata: {
        provider: "instagram",
        reason: storedState ? "meta_oauth_invalid" : "meta_oauth_cookie_missing",
      },
    });
    return fail(
      storedState ? "meta_oauth_invalid" : "meta_oauth_cookie_missing",
      400,
    );
  }

  const nextPath = sanitizeNextPath(params.nextPath ?? storedNext ?? oauthState.nextPath);

  let tokenData: Awaited<ReturnType<typeof exchangeCodeForToken>> | null = null;
  try {
    tokenData = await withHardTimeout(
      exchangeCodeForToken(params.code),
      TOKEN_EXCHANGE_MS,
      null,
      "oauth-meta-code-exchange",
    );
  } catch (error) {
    const code = classifyMetaOAuthError(error);
    return fail(code, 400, error instanceof Error ? error.message : String(error));
  }

  if (!tokenData) {
    return fail("meta_token_timeout", 504);
  }

  let profile: Awaited<ReturnType<typeof getInstagramProfile>> | null = null;
  try {
    profile = await withHardTimeout(
      getInstagramProfile(tokenData.access_token),
      PROFILE_FETCH_MS,
      null,
      "oauth-meta-profile",
    );
  } catch (error) {
    const code = classifyMetaOAuthError(error, { timedOut: false });
    return fail(
      code === "meta_exchange_unknown" ? "meta_profile_timeout" : code,
      400,
      error instanceof Error ? error.message : String(error),
    );
  }

  if (!profile) {
    return fail("meta_profile_timeout", 504);
  }

  if (profile.account_type && !isProfessionalInstagramAccount(profile.account_type)) {
    return fail("meta_no_instagram", 400);
  }

  const supabase = createAdminClient();
  const existingOwnerId = await withHardTimeout(
    findInstagramAccountOwner(supabase, profile.id),
    OWNER_LOOKUP_MS,
    null,
    "oauth-meta-owner-lookup",
  );

  const ownerResult = resolveOAuthOwnerIdForLogin(request, {
    existingOwnerId,
    addAccount,
  });

  if ("error" in ownerResult) {
    return fail("meta_session_required", 401);
  }

  const ownerId = ownerResult.ownerId;
  const sessionToken = resolveOAuthCallbackSessionTokenFast(request, ownerId);
  const shortToken = tokenData.access_token;

  waitUntil(
    (async () => {
      let longToken = shortToken;
      try {
        longToken = await getLongLivedToken(shortToken);
      } catch (error) {
        console.warn("[oauth-meta-long-token-background-failed]", {
          code: classifyMetaOAuthError(error),
        });
      }

      try {
        const effectiveOwnerId = await persistInstagramAccountTokens(
          supabase,
          ownerId,
          profile,
          longToken,
        );

        await upsertAppSessionRow(supabase, {
          ownerId: effectiveOwnerId,
          sessionToken,
          encryptedAccessToken: encryptSessionAccessToken(longToken),
          label: "oauth-meta-session-upsert",
        });

        await logSecurityEvent({
          ownerId: effectiveOwnerId,
          eventType: "login_success",
          ipAddress: getClientIp(request),
          userAgent: request.headers.get("user-agent"),
          metadata: { provider: "instagram", igUserId: profile.id, persistence: "background" },
        });
      } catch (error) {
        console.warn("[oauth-meta-persistence-background-failed]", {
          code: "supabase_persistence_timeout",
          error: error instanceof Error ? error.message : String(error),
        });
      }
    })(),
  );

  return {
    ok: true,
    ownerId,
    sessionToken,
    sessionCreated: true,
    persistencePending: true,
    redirectTo: `${nextPath}?connected=1`,
  };
}
