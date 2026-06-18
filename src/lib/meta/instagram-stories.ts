import type { AuthProvider } from "@/lib/meta/instagram";

function getGraphBase(provider: AuthProvider = "instagram") {
  return provider === "facebook"
    ? "https://graph.facebook.com/v21.0"
    : "https://graph.instagram.com/v21.0";
}

export type StoryPublishCapability = {
  autoPublishReady: boolean;
  message: string;
  scopes?: string[];
};

const STORY_PUBLISH_SCOPES = new Set([
  "instagram_content_publish",
  "instagram_basic",
  "pages_show_list",
  "pages_read_engagement",
]);

export async function checkInstagramStoryPublishCapability(params: {
  accessToken: string;
  provider?: AuthProvider;
}): Promise<StoryPublishCapability> {
  const envFlag = process.env.INSTAGRAM_STORIES_PUBLISH_ENABLED?.trim().toLowerCase();
  if (envFlag === "true") {
    return {
      autoPublishReady: true,
      message: "Publicação automática de Stories habilitada pela configuração do servidor.",
    };
  }
  if (envFlag === "false") {
    return {
      autoPublishReady: false,
      message:
        "Publicação automática de Stories desativada. Stories ficam agendados até você habilitar a integração com a Meta.",
    };
  }

  const appId = process.env.META_APP_ID ?? process.env.INSTAGRAM_APP_ID;
  const appSecret = process.env.META_APP_SECRET ?? process.env.INSTAGRAM_APP_SECRET;

  if (appId && appSecret) {
    try {
      const res = await fetch(
        `https://graph.facebook.com/v21.0/debug_token?input_token=${encodeURIComponent(params.accessToken)}&access_token=${encodeURIComponent(`${appId}|${appSecret}`)}`,
        { cache: "no-store" },
      );
      const data = await res.json();
      const scopes: string[] =
        data.data?.scopes ??
        data.data?.granular_scopes?.map((item: { scope: string }) => item.scope) ??
        [];

      const hasPublish = scopes.some((scope) => STORY_PUBLISH_SCOPES.has(scope));
      if (hasPublish) {
        return {
          autoPublishReady: true,
          message: "Token com permissão de publicação de conteúdo (instagram_content_publish).",
          scopes,
        };
      }

      return {
        autoPublishReady: false,
        message:
          "Token sem permissão confirmada para publicar Stories automaticamente. O story ficará agendado até a permissão ser liberada na Meta.",
        scopes,
      };
    } catch {
      // fall through to safe default
    }
  }

  return {
    autoPublishReady: false,
    message:
      "Não foi possível validar permissão de Stories na Meta. Stories serão salvos como agendados; configure INSTAGRAM_STORIES_PUBLISH_ENABLED=true após aprovação do app.",
  };
}

async function graphPost(
  path: string,
  token: string,
  body: Record<string, string>,
  provider: AuthProvider = "instagram",
) {
  const graph = getGraphBase(provider);
  const params = new URLSearchParams({ ...body, access_token: token });
  const res = await fetch(`${graph}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params,
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error?.message ?? "Erro na API do Instagram (Story)");
  }
  return data;
}

async function graphGet(path: string, token: string, provider: AuthProvider = "instagram") {
  const graph = getGraphBase(provider);
  const res = await fetch(`${graph}${path}&access_token=${token}`, { cache: "no-store" });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error?.message ?? "Erro na API do Instagram (Story)");
  }
  return data;
}

async function waitForContainer(
  containerId: string,
  token: string,
  provider: AuthProvider = "instagram",
) {
  for (let i = 0; i < 30; i++) {
    const data = await graphGet(`/${containerId}?fields=status_code`, token, provider);
    if (data.status_code === "FINISHED") return;
    if (data.status_code === "ERROR") {
      throw new Error("Processamento do Story falhou no Instagram");
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
  throw new Error("Timeout aguardando processamento do Story");
}

export async function publishInstagramStory(params: {
  igUserId: string;
  token: string;
  mediaUrl: string;
  provider?: AuthProvider;
}) {
  const isVideo = params.mediaUrl.match(/\.(mp4|mov|webm)$/i);
  const body: Record<string, string> = {
    media_type: "STORIES",
    ...(isVideo ? { video_url: params.mediaUrl } : { image_url: params.mediaUrl }),
  };

  const container = await graphPost(`/${params.igUserId}/media`, params.token, body, params.provider);
  await waitForContainer(container.id, params.token, params.provider);
  const published = await graphPost(
    `/${params.igUserId}/media_publish`,
    params.token,
    { creation_id: container.id },
    params.provider,
  );

  let permalink: string | null = null;
  try {
    const data = await graphGet(`/${published.id}?fields=permalink`, params.token, params.provider);
    permalink = data.permalink ?? null;
  } catch {
    // Stories podem não retornar permalink estável
  }

  return {
    containerId: container.id as string,
    mediaId: published.id as string,
    permalink,
  };
}
