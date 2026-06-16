const HASHTAG_TAIL = /((?:#\w[\w.]*\s*)+)$/u;

const EMOJI_AT_START =
  /^(?:[\u{1F300}-\u{1FAFF}\u2600-\u27BF]|[\u{1F1E6}-\u{1F1FF}]{2})/u;

export const CAPTION_LAYOUT_EXAMPLE = `📌 Siga @DeOlhoNoShape para mais!

🔥 Talvez você não encontre essa página de novo.
💪 Então siga e continue evoluindo.

#academia #fitness #maromba #musculacao #shape`;

function extractHashtagBlock(text: string) {
  const match = text.match(HASHTAG_TAIL);
  if (!match?.[1] || match.index === undefined) {
    return { body: text.trim(), hashtags: "" };
  }

  return {
    body: text.slice(0, match.index).trim(),
    hashtags: match[1].replace(/\s+/g, " ").trim(),
  };
}

function findEmojiSplitIndexes(line: string) {
  const indexes: number[] = [];

  for (let index = 0; index < line.length; index++) {
    if (index === 0) continue;

    const slice = line.slice(index);
    if (EMOJI_AT_START.test(slice)) {
      indexes.push(index);
    }
  }

  return indexes;
}

function splitByEmojiSegments(line: string) {
  const indexes = findEmojiSplitIndexes(line);
  if (!indexes.length) {
    return [line.trim()];
  }

  const segments: string[] = [];
  let start = 0;

  for (const index of indexes) {
    const part = line.slice(start, index).trim();
    if (part) segments.push(part);
    start = index;
  }

  const tail = line.slice(start).trim();
  if (tail) segments.push(tail);

  return segments.filter(Boolean);
}

function splitHookFromBody(line: string) {
  const match = line.match(/^(.+?[.!?…])(\s+)(.+)$/u);
  if (!match || line.length < 80) {
    return [line.trim()];
  }

  const first = match[1].trim();
  const rest = match[3].trim();
  if (!rest) return [first];

  return [first, ...splitByEmojiSegments(rest)];
}

function expandBodyLines(body: string) {
  const lines = body
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  if (!lines.length) return [] as string[];

  const blocks: string[] = [];

  for (const line of lines) {
    const emojiSegments = splitByEmojiSegments(line);
    if (emojiSegments.length > 1) {
      blocks.push(...emojiSegments);
      continue;
    }

    if (line.length > 90) {
      blocks.push(...splitHookFromBody(line));
      continue;
    }

    blocks.push(line);
  }

  return blocks;
}

/** Padroniza quebras de linha para o estilo Instagram (blocos + linha em branco antes das hashtags). */
export function formatInstagramCaption(raw: string) {
  const normalized = raw.replace(/\r\n/g, "\n").trim();
  if (!normalized) return normalized;

  const { body, hashtags } = extractHashtagBlock(normalized);
  const blocks = expandBodyLines(body);
  const formattedBody = blocks.join("\n").trim();

  if (hashtags) {
    return formattedBody ? `${formattedBody}\n\n${hashtags}` : hashtags;
  }

  return formattedBody;
}

export function formatInstagramCaptions(captions: string[]) {
  return captions.map((caption) => formatInstagramCaption(caption));
}
