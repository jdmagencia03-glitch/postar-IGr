export type MetaOAuthErrorCode =
  | "meta_token_timeout"
  | "meta_invalid_secret"
  | "meta_redirect_uri_mismatch"
  | "meta_code_used"
  | "meta_profile_timeout"
  | "meta_oauth_invalid"
  | "meta_oauth_cookie_missing"
  | "meta_no_instagram"
  | "meta_session_required"
  | "session_cookie_failed"
  | "meta_exchange_unknown";

const USER_MESSAGES: Record<MetaOAuthErrorCode, string> = {
  meta_token_timeout: "Não foi possível conectar ao Instagram agora. Tente novamente.",
  meta_invalid_secret: "Configuração do app Instagram incorreta. Contate o suporte.",
  meta_redirect_uri_mismatch: "Redirect URI do app não confere. Contate o suporte.",
  meta_code_used: "Link de login expirou. Clique em Conectar Instagram novamente.",
  meta_profile_timeout: "Não foi possível carregar seu perfil Instagram. Tente novamente.",
  meta_oauth_invalid: "Falha na autenticação. Tente novamente.",
  meta_oauth_cookie_missing:
    "Sessão OAuth expirou. Use o mesmo navegador e permita cookies.",
  meta_no_instagram:
    "Nenhuma conta Instagram Business/Creator vinculada a uma Página do Facebook.",
  meta_session_required: "Faça login antes de adicionar outra conta Instagram.",
  session_cookie_failed: "Não foi possível iniciar sua sessão. Tente novamente.",
  meta_exchange_unknown: "Falha ao conectar Instagram. Tente novamente.",
};

export function userMessageForMetaOAuthError(code: MetaOAuthErrorCode): string {
  return USER_MESSAGES[code];
}

export function classifyMetaOAuthError(
  error: unknown,
  context?: { timedOut?: boolean },
): MetaOAuthErrorCode {
  if (context?.timedOut) {
    return "meta_token_timeout";
  }

  const message = (error instanceof Error ? error.message : String(error)).toLowerCase();

  if (message.includes("abort") || message.includes("timeout")) {
    return "meta_token_timeout";
  }
  if (
    message.includes("redirect_uri") ||
    message.includes("redirect uri") ||
    message.includes("verification code")
  ) {
    return message.includes("redirect") ? "meta_redirect_uri_mismatch" : "meta_code_used";
  }
  if (message.includes("code") && (message.includes("used") || message.includes("expired"))) {
    return "meta_code_used";
  }
  if (
    message.includes("client_secret") ||
    message.includes("invalid secret") ||
    message.includes("oauth") && message.includes("secret")
  ) {
    return "meta_invalid_secret";
  }
  if (message.includes("perfil") || message.includes("profile")) {
    return "meta_profile_timeout";
  }

  return "meta_exchange_unknown";
}

export function logMetaOAuthError(code: MetaOAuthErrorCode, detail?: string) {
  console.error("[oauth-meta-exchange-error]", {
    code,
    detail: detail?.slice(0, 200),
  });
}
