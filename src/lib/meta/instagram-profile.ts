import type { AuthProvider } from "@/lib/meta/instagram";

function getGraphBase(provider: AuthProvider = "instagram") {
  return provider === "facebook"
    ? "https://graph.facebook.com/v21.0"
    : "https://graph.instagram.com/v21.0";
}

async function graphGet(path: string, token: string, provider: AuthProvider = "instagram") {
  const graph = getGraphBase(provider);
  const res = await fetch(`${graph}${path}&access_token=${token}`, { cache: "no-store" });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message ?? "Erro ao buscar dados do Instagram");
  return data;
}

export interface InstagramProfileSnapshot {
  username: string;
  name: string;
  biography: string;
  captions: string[];
  hashtags: string[];
  themes: string[];
}

function extractHashtags(captions: string[]) {
  const tags = new Set<string>();
  for (const caption of captions) {
    const matches = caption.match(/#[\w\u00C0-\u017F]+/g) ?? [];
    matches.forEach((tag) => tags.add(tag.toLowerCase()));
  }
  return Array.from(tags).slice(0, 15);
}

function inferThemes(captions: string[], biography: string) {
  const corpus = [biography, ...captions].join(" ").toLowerCase();
  const themes: string[] = [];
  const map: Array<[RegExp, string]> = [
    [/fitness|treino|academia|shape|muscul/, "Fitness e treino"],
    [/beleza|unha|skincare|maquiagem/, "Beleza"],
    [/moda|look|estilo/, "Moda"],
    [/receita|comida|culin/, "Culinária"],
    [/pet|cachorro|gato/, "Pets"],
    [/humor|engraç/, "Humor"],
    [/motiv|inspir/, "Motivação"],
    [/negócio|empreend|vendas/, "Negócios"],
    [/educa|aula|dica/, "Educação"],
  ];
  for (const [pattern, label] of map) {
    if (pattern.test(corpus)) themes.push(label);
  }
  return themes.slice(0, 5);
}

export async function fetchInstagramProfileSnapshot(params: {
  accessToken: string;
  igUserId: string;
  provider?: AuthProvider;
  mediaLimit?: number;
}): Promise<InstagramProfileSnapshot> {
  const provider = params.provider ?? "instagram";
  const mediaLimit = params.mediaLimit ?? 12;
  const profilePath =
    provider === "facebook"
      ? `/${params.igUserId}?fields=username,name,biography`
      : "/me?fields=username,name,biography";

  const profile = await graphGet(profilePath, params.accessToken, provider);
  const mediaPath =
    provider === "facebook"
      ? `/${params.igUserId}/media?fields=caption,media_type,timestamp&limit=${mediaLimit}`
      : `/me/media?fields=caption,media_type,timestamp&limit=${mediaLimit}`;

  const media = await graphGet(mediaPath, params.accessToken, provider);
  const captions = ((media.data as Array<{ caption?: string }>) ?? [])
    .map((item) => item.caption?.trim())
    .filter(Boolean) as string[];

  const biography = (profile.biography as string) ?? "";
  const hashtags = extractHashtags(captions);
  const themes = inferThemes(captions, biography);

  return {
    username: (profile.username as string) ?? "",
    name: (profile.name as string) ?? "",
    biography,
    captions: captions.slice(0, mediaLimit),
    hashtags,
    themes,
  };
}
