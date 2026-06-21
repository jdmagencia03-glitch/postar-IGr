import { getTikTokRedirectUri } from "@/lib/tiktok/oauth";
import { APP_NAME } from "@/lib/brand";

export function resolveTikTokOAuthError(error?: string | null) {
  if (!error) return null;

  const normalized = error.toLowerCase();

  if (normalized.includes("access_denied") || normalized.includes("user_denied")) {
    return {
      title: "Autorização cancelada",
      message: "Você cancelou a conexão com o TikTok.",
      steps: ["Clique em Conectar TikTok e autorize todas as permissões solicitadas."],
    };
  }

  if (normalized.includes("redirect_uri") || normalized.includes("redirect uri")) {
    return {
      title: "Redirect URI incorreto",
      message:
        `A URL de callback enviada pelo ${APP_NAME} não bate com a cadastrada no app TikTok (Production → Login Kit → Web).`,
      steps: [
        "No TikTok for Developers → Production (Live) → Login Kit → Web.",
        "Redirect URI exatamente:",
        getTikTokRedirectUri(),
        "Sem barra no final. Salve e tente de novo.",
      ],
    };
  }

  if (normalized.includes("non_sandbox_target")) {
    return {
      title: "Conta não autorizada no Sandbox",
      message:
        "No modo Sandbox, só contas adicionadas como Target User podem conectar. Adicione esta conta TikTok no portal TikTok for Developers.",
      steps: [
        "Abra developers.tiktok.com → seu app → modo Sandbox.",
        "Vá em Sandbox settings → Target users → Add account.",
        `Faça login com a MESMA conta TikTok que você usa para conectar no ${APP_NAME}.`,
        "Tente conectar novamente.",
      ],
    };
  }

  if (normalized.includes("scope")) {
    return {
      title: "Permissões (scopes) não conferem",
      message:
        "O TikTok recusou a autorização porque os scopes solicitados não batem com os aprovados no app. Confira Login Kit + Content Posting API no portal e alinhe TIKTOK_SCOPES na Vercel.",
      steps: [
        "Scopes necessários: user.info.basic, user.info.profile, video.upload, video.publish.",
        "No TikTok for Developers → Scopes, confirme que os quatro estão ativos na versão Production (Live).",
        "Na Vercel, TIKTOK_SCOPES deve ser exatamente: user.info.basic,user.info.profile,video.upload,video.publish",
        "Faça redeploy após alterar a variável e tente conectar de novo.",
      ],
    };
  }

  if (normalized.includes("client_key") || normalized.includes("invalid_client")) {
    return {
      title: "Credenciais TikTok inválidas",
      message:
        "O client_key ou client_secret não foi aceito pelo TikTok. Use as credenciais da versão Production (Live) do app, não as do Sandbox.",
      steps: [
        "No TikTok for Developers → Production → Credentials, copie Client key e Client secret.",
        "Atualize TIKTOK_CLIENT_KEY e TIKTOK_CLIENT_SECRET na Vercel (Production).",
        "Confirme que TIKTOK_REDIRECT_URI é https://postarigr.vercel.app/api/auth/tiktok/callback",
        "Redeploy e tente novamente.",
      ],
    };
  }

  if (normalized.includes("not configured") || normalized.includes("não configurado")) {
    return {
      title: "App TikTok não configurado no servidor",
      message: "TIKTOK_CLIENT_KEY ou TIKTOK_CLIENT_SECRET não estão definidos na Vercel.",
      steps: [
        "Configure TIKTOK_CLIENT_KEY e TIKTOK_CLIENT_SECRET na Vercel (ambiente Production).",
        "Ative Login Kit + Content Posting API no portal TikTok.",
        "Redeploy após salvar as variáveis.",
      ],
    };
  }

  return {
    title: "Erro ao conectar TikTok",
    message: error,
    steps: ["Tente novamente. Se persistir, verifique o app no TikTok for Developers."],
  };
}
