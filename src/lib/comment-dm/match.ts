/** Normaliza texto para comparação de palavras-chave. */
export function normalizeCommentText(text: string) {
  return text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Retorna a palavra-chave correspondente (a mais longa primeiro). */
export function matchCommentKeyword(commentText: string, keywords: string[]) {
  const normalized = normalizeCommentText(commentText);
  if (!normalized) return null;

  const sorted = [...keywords]
    .map((k) => k.trim())
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);

  for (const keyword of sorted) {
    const needle = normalizeCommentText(keyword);
    if (!needle) continue;
    if (normalized.includes(needle)) return keyword;
  }

  return null;
}

export function renderDmMessage(
  template: string,
  vars: {
    keyword: string;
    username?: string;
    link?: string | null;
  },
) {
  const link = vars.link?.trim() ?? "";
  let message = template
    .replace(/\{keyword\}/gi, vars.keyword)
    .replace(/\{palavra\}/gi, vars.keyword)
    .replace(/\{username\}/gi, vars.username ? `@${vars.username.replace(/^@/, "")}` : "")
    .replace(/\{usuario\}/gi, vars.username ? `@${vars.username.replace(/^@/, "")}` : "")
    .replace(/\{link\}/gi, link);

  if (link && !message.includes(link)) {
    message = `${message.trim()}\n\n${link}`;
  }

  return message.trim();
}

export function mediaMatchesScope(
  applyTo: "all" | "specific",
  targetMediaIds: string[],
  mediaId?: string,
) {
  if (applyTo === "all") return true;
  if (!mediaId) return false;
  return targetMediaIds.includes(mediaId);
}
