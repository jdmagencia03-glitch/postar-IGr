import type { MediaType } from "@/lib/types";

const GRAPH = "https://graph.instagram.com/v21.0";

async function graphPost(path: string, token: string, body: Record<string, string>) {
  const params = new URLSearchParams({ ...body, access_token: token });
  const res = await fetch(`${GRAPH}${path}`, {
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

async function graphGet(path: string, token: string) {
  const res = await fetch(`${GRAPH}${path}&access_token=${token}`);
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
}) {
  const { igUserId, token, mediaType, mediaUrls, caption } = params;

  if (mediaType === "CAROUSEL" && mediaUrls.length > 1) {
    const children: string[] = [];

    for (const url of mediaUrls) {
      const isVideo = url.match(/\.(mp4|mov|webm)$/i);
      const child = await graphPost(`/${igUserId}/media`, token, {
        ...(isVideo ? { media_type: "VIDEO", video_url: url } : { image_url: url }),
        is_carousel_item: "true",
      });
      children.push(child.id);
    }

    return graphPost(`/${igUserId}/media`, token, {
      media_type: "CAROUSEL",
      children: children.join(","),
      ...(caption ? { caption } : {}),
    });
  }

  const url = mediaUrls[0];
  const isVideo = mediaType === "REELS" || url.match(/\.(mp4|mov|webm)$/i);

  if (isVideo) {
    return graphPost(`/${igUserId}/media`, token, {
      media_type: mediaType === "REELS" ? "REELS" : "VIDEO",
      video_url: url,
      ...(caption ? { caption } : {}),
    });
  }

  return graphPost(`/${igUserId}/media`, token, {
    image_url: url,
    ...(caption ? { caption } : {}),
  });
}

export async function waitForContainer(containerId: string, token: string, maxAttempts = 30) {
  for (let i = 0; i < maxAttempts; i++) {
    const data = await graphGet(`/${containerId}?fields=status_code`, token);

    if (data.status_code === "FINISHED") return;
    if (data.status_code === "ERROR") {
      throw new Error("Processamento da mídia falhou no Instagram");
    }

    await new Promise((r) => setTimeout(r, 3000));
  }

  throw new Error("Timeout aguardando processamento da mídia");
}

export async function publishContainer(igUserId: string, containerId: string, token: string) {
  return graphPost(`/${igUserId}/media_publish`, token, {
    creation_id: containerId,
  });
}

export async function getMediaPermalink(mediaId: string, token: string) {
  const data = await graphGet(`/${mediaId}?fields=permalink`, token);
  return data.permalink as string;
}

export async function publishPost(params: {
  igUserId: string;
  token: string;
  mediaType: MediaType;
  mediaUrls: string[];
  caption?: string;
}) {
  const container = await createMediaContainer(params);
  await waitForContainer(container.id, params.token);
  const published = await publishContainer(params.igUserId, container.id, params.token);
  const permalink = await getMediaPermalink(published.id, params.token);

  return {
    containerId: container.id as string,
    mediaId: published.id as string,
    permalink,
  };
}
