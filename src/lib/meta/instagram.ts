import type { MediaType } from "@/lib/types";
import {
  isInstagramContainerProcessingError,
  waitForInstagramContainer,
} from "@/lib/meta/instagram-container";

export {
  fetchInstagramContainerStatus,
  isInstagramContainerProcessingError,
  InstagramContainerProcessingError,
} from "@/lib/meta/instagram-container";

export type AuthProvider = "instagram" | "facebook";

function getGraphBase(provider: AuthProvider = "instagram") {
  return provider === "facebook"
    ? "https://graph.facebook.com/v21.0"
    : "https://graph.instagram.com/v21.0";
}

export type InstagramAccountStatus = "active" | "error";

export interface InstagramAccountHealth {
  status: InstagramAccountStatus;
  message: string;
  error_code?: number;
}

interface InstagramApiError {
  message?: string;
  code?: number;
  type?: string;
  error_subcode?: number;
}

export function mapInstagramApiError(error?: InstagramApiError): InstagramAccountHealth {
  const code = error?.code;
  const message = error?.message?.toLowerCase() ?? "";

  if (code === 190 || message.includes("expired") || message.includes("invalid oauth")) {
    return {
      status: "error",
      message: "Token expirado — reconecte sua conta",
      error_code: code,
    };
  }

  if (code === 10 || message.includes("permission")) {
    return {
      status: "error",
      message: "Permissão negada — reconecte a conta",
      error_code: code,
    };
  }

  if (
    message.includes("disabled") ||
    message.includes("suspended") ||
    message.includes("blocked") ||
    message.includes("checkpoint")
  ) {
    return {
      status: "error",
      message: "Conta suspensa, bloqueada ou com restrição no Instagram",
      error_code: code,
    };
  }

  if (code === 2 || message.includes("temporarily unavailable")) {
    return {
      status: "error",
      message: "Instagram temporariamente indisponível",
      error_code: code,
    };
  }

  return {
    status: "error",
    message: error?.message ?? "Falha na conexão com o Instagram",
    error_code: code,
  };
}

export async function checkInstagramAccountHealth(
  accessToken: string,
  options?: { provider?: AuthProvider; igUserId?: string },
): Promise<InstagramAccountHealth> {
  try {
    const provider = options?.provider ?? "instagram";
    const graph = getGraphBase(provider);
    const path =
      provider === "facebook" && options?.igUserId
        ? `/${options.igUserId}?fields=id,username`
        : "/me?fields=id,username";
    const res = await fetch(`${graph}${path}&access_token=${accessToken}`, {
      cache: "no-store",
    });
    const data = await res.json();

    if (!res.ok) {
      return mapInstagramApiError(data.error as InstagramApiError);
    }

    if (!data.id && !data.user_id) {
      return {
        status: "error",
        message: "Conta Instagram não encontrada",
      };
    }

    return {
      status: "active",
      message: "Conta operacional — tudo suave",
    };
  } catch {
    return {
      status: "error",
      message: "Instagram indisponível no momento",
    };
  }
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
    throw new Error(data.error?.message ?? "Erro na API do Instagram");
  }

  return data;
}

async function graphGet(path: string, token: string, provider: AuthProvider = "instagram") {
  const graph = getGraphBase(provider);
  const res = await fetch(`${graph}${path}&access_token=${token}`);
  const data = await res.json();

  if (!res.ok) {
    throw new Error(data.error?.message ?? "Erro na API do Instagram");
  }

  return data;
}

export async function createMediaContainer(params: {
  igUserId: string;
  token: string;
  mediaType: MediaType;
  mediaUrls: string[];
  caption?: string;
  provider?: AuthProvider;
}) {
  const { igUserId, token, mediaType, mediaUrls, caption, provider = "instagram" } = params;

  if (mediaType === "CAROUSEL" && mediaUrls.length > 1) {
    const children: string[] = [];

    for (const url of mediaUrls) {
      const isVideo = url.match(/\.(mp4|mov|webm)$/i);
      const child = await graphPost(
        `/${igUserId}/media`,
        token,
        {
          ...(isVideo ? { media_type: "VIDEO", video_url: url } : { image_url: url }),
          is_carousel_item: "true",
        },
        provider,
      );
      children.push(child.id);
    }

    return graphPost(
      `/${igUserId}/media`,
      token,
      {
        media_type: "CAROUSEL",
        children: children.join(","),
        ...(caption ? { caption } : {}),
      },
      provider,
    );
  }

  const url = mediaUrls[0];
  const isVideo = mediaType === "REELS" || url.match(/\.(mp4|mov|webm)$/i);

  if (isVideo) {
    return graphPost(
      `/${igUserId}/media`,
      token,
      {
        media_type: mediaType === "REELS" ? "REELS" : "VIDEO",
        video_url: url,
        ...(caption ? { caption } : {}),
      },
      provider,
    );
  }

  return graphPost(
    `/${igUserId}/media`,
    token,
    {
      image_url: url,
      ...(caption ? { caption } : {}),
    },
    provider,
  );
}

export async function waitForContainer(
  containerId: string,
  token: string,
  maxAttempts = 30,
  provider: AuthProvider = "instagram",
  pollIntervalMs = 3000,
) {
  await waitForInstagramContainer({
    containerId,
    token,
    maxAttempts,
    provider,
    pollIntervalMs,
  });
}

export function formatInstagramPublishError(error: unknown) {
  if (isInstagramContainerProcessingError(error)) {
    return error.logMessage();
  }
  return error instanceof Error ? error.message : "Erro desconhecido no Instagram";
}

export async function publishContainer(
  igUserId: string,
  containerId: string,
  token: string,
  provider: AuthProvider = "instagram",
) {
  return graphPost(`/${igUserId}/media_publish`, token, { creation_id: containerId }, provider);
}

export async function getMediaPermalink(
  mediaId: string,
  token: string,
  provider: AuthProvider = "instagram",
) {
  const data = await graphGet(`/${mediaId}?fields=permalink`, token, provider);
  return data.permalink as string;
}

export async function getInstagramAccountStats(
  accessToken: string,
  options?: { provider?: AuthProvider; igUserId?: string },
) {
  const provider = options?.provider ?? "instagram";
  const graph = getGraphBase(provider);
  const path = provider === "facebook" && options?.igUserId ? `/${options.igUserId}` : "/me";
  const fields = [
    "user_id",
    "username",
    "name",
    "account_type",
    "profile_picture_url",
    "followers_count",
    "follows_count",
    "media_count",
  ].join(",");

  const res = await fetch(`${graph}${path}?fields=${fields}&access_token=${accessToken}`, {
    next: { revalidate: 0 },
  });
  const data = await res.json();

  if (!res.ok) {
    const health = mapInstagramApiError(data.error as InstagramApiError);
    throw new Error(health.message);
  }

  return {
    user_id: String(data.user_id ?? data.id ?? ""),
    username: data.username as string | undefined,
    name: data.name as string | undefined,
    account_type: data.account_type as string | undefined,
    profile_picture_url: data.profile_picture_url as string | undefined,
    followers_count: Number(data.followers_count ?? 0),
    follows_count: Number(data.follows_count ?? 0),
    media_count: Number(data.media_count ?? 0),
  };
}

export async function deletePublishedMedia(
  mediaId: string,
  token: string,
  provider: AuthProvider = "instagram",
) {
  const graph = getGraphBase(provider);
  const res = await fetch(`${graph}/${mediaId}?access_token=${token}`, {
    method: "DELETE",
  });
  const data = await res.json();

  if (!res.ok) {
    throw new Error(data.error?.message ?? "Erro ao excluir publicação no Instagram");
  }

  return data;
}

export async function publishPost(params: {
  igUserId: string;
  token: string;
  mediaType: MediaType;
  mediaUrls: string[];
  caption?: string;
  provider?: AuthProvider;
}) {
  const provider = params.provider ?? "instagram";
  const container = await createMediaContainer({ ...params, provider });
  const isVideo = params.mediaType === "REELS" || params.mediaUrls[0]?.match(/\.(mp4|mov|webm)$/i);
  await waitForContainer(
    container.id,
    params.token,
    isVideo ? 72 : 30,
    provider,
    isVideo ? 5000 : 3000,
  );
  const published = await publishContainer(params.igUserId, container.id, params.token, provider);

  let permalink: string | null = null;
  try {
    permalink = await getMediaPermalink(published.id, params.token, provider);
  } catch {
    // Publicação já ocorreu — permalink é opcional
  }

  return {
    containerId: container.id as string,
    mediaId: published.id as string,
    permalink,
  };
}
