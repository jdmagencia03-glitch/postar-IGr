export interface MetaErrorGuide {
  title: string;
  message: string;
  steps: string[];
  autoFixable: boolean;
}

function normalizeError(value: string) {
  return decodeURIComponent(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

export function resolveMetaOAuthError(rawError?: string | null): MetaErrorGuide | null {
  if (!rawError?.trim()) return null;

  const error = normalizeError(rawError);

  if (
    error.includes("insufficient developer") ||
    error.includes("funcao de desenvolvedor e insuficiente") ||
    error.includes("developer role") ||
    error.includes("oauthexception") && error.includes("400")
  ) {
    return {
      title: "Conta não autorizada no app Meta",
      message:
        "O app está em modo desenvolvimento. A Meta só permite conectar contas que foram adicionadas como testadoras — ou o app precisa estar em modo Live.",
      steps: [
        "Abra developers.facebook.com → seu app → Funções do app → Funções",
        "Clique em Adicionar pessoas → Instagram Tester",
        "Digite o @ da conta que quer conectar e confirme",
        "No Instagram: Configurações → Apps e sites → Convites de teste → Aceitar",
        "Tente de novo em aba anônima (ou use “Conectar via Facebook” abaixo)",
        "Para qualquer conta conectar automaticamente: ative Modo Live + App Review na Meta (passo único)",
      ],
      autoFixable: false,
    };
  }

  if (
    error.includes("unsupported request") ||
    error.includes("method type: get") ||
    error.includes("igapiexception")
  ) {
    return {
      title: "Permissões da API não liberadas",
      message:
        "O login começou, mas a Meta bloqueou a troca do token. Isso acontece quando o app está publicado mas as permissões Instagram ainda não têm Acesso Avançado aprovado.",
      steps: [
        "Meta Developer → Casos de uso → Gerenciar mensagens e conteúdo no Instagram",
        "Solicite Acesso Avançado para instagram_business_basic e instagram_business_content_publish",
        "Confirme se INSTAGRAM_APP_ID e INSTAGRAM_APP_SECRET na Vercel são do produto Instagram",
        "Em Facebook Login → URIs de redirecionamento: https://postarigr.vercel.app/api/auth/facebook/callback",
        "Tente Via Facebook em Contas após configurar",
      ],
      autoFixable: false,
    };
  }

  if (error.includes("access_denied") || error.includes("user_denied")) {
    return {
      title: "Autorização cancelada",
      message: "Você cancelou o login no Instagram/Facebook.",
      steps: ["Clique em Adicionar conta e autorize todas as permissões solicitadas."],
      autoFixable: true,
    };
  }

  if (error.includes("redirect_uri") || error.includes("redirect uri")) {
    return {
      title: "URL de retorno incorreta",
      message: "A URL de callback não bate com a configurada no app Meta.",
      steps: [
        "No Meta Dashboard → Instagram → Login → OAuth redirect URIs",
        "Adicione exatamente: https://postarigr.vercel.app/api/auth/meta/callback",
        "Salve e tente novamente",
      ],
      autoFixable: false,
    };
  }

  if (error.includes("business") || error.includes("creator") || error.includes("professional")) {
    return {
      title: "Conta precisa ser profissional",
      message: "A API da Meta só funciona com contas Instagram Business ou Creator.",
      steps: [
        "No Instagram: Configurações → Conta → Mudar para conta profissional",
        "Escolha Business ou Creator e conclua o setup",
        "Tente conectar novamente",
      ],
      autoFixable: false,
    };
  }

  return {
    title: "Erro ao conectar conta",
    message: decodeURIComponent(rawError),
    steps: [
      "Tente em aba anônima para escolher outra conta Instagram",
      "Use o botão “Conectar via Facebook” se a conta tem Página vinculada",
      "Se persistir, verifique o app Meta em developers.facebook.com",
    ],
    autoFixable: false,
  };
}
