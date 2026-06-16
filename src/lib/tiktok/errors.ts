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
        `A URL de callback enviada pelo ${APP_NAME} não bate com a cadastrada no app TikTok (modo Sandbox).`,
      steps: [
        "No TikTok for Developers, confirme modo Sandbox (não Production).",
        "Login Kit → Web → Redirect URI exatamente:",
        getTikTokRedirectUri(),
        "Sem barra no final. Clique Apply changes e tente de novo.",
        "Use credenciais Sandbox na Vercel e conta em Target users.",
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

  if (normalized.includes("scope") || normalized.includes("client_key")) {
    return {
      title: "App TikTok não configurado",
      message: "Verifique Login Kit, Content Posting API e scopes no portal TikTok.",
      steps: [
        "Ative Login Kit + Content Posting API (Direct Post).",
        "Solicite scopes: user.info.basic, user.info.profile, video.upload, video.publish.",
        "Configure TIKTOK_CLIENT_KEY e TIKTOK_CLIENT_SECRET na Vercel.",
      ],
    };
  }

  return {
    title: "Erro ao conectar TikTok",
    message: error,
    steps: ["Tente novamente. Se persistir, verifique o app no TikTok for Developers."],
  };
}
