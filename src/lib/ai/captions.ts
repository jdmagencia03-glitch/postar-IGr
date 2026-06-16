import {
  buildViralSystemPrompt,
  buildViralUserPrompt,
  getPlaybookForOwner,
} from "@/lib/ai/playbook";
import { formatInstagramCaption } from "@/lib/ai/caption-format";
import { CAPTION_BATCH_SIZE } from "@/lib/autopilot-constants";

const HOOKS = [
  "Esse treino mudou meu dia 🔥",
  "Resultado de verdade, sem enrolação 💪",
  "Salva esse Reel e treina hoje 🚀",
  "Dica rápida que faz diferença no shape ✨",
  "Mais um passo rumo ao seu objetivo 🎯",
  "Conteúdo direto ao ponto pra você evoluir 📈",
  "Rotina simples, resultado consistente ⚡",
  "Bora manter o foco no processo 🔁",
];

const HASHTAG_SETS = [
  "#fitness #treino #reels #fyp #viral #academia #saude #motivacao #lifestyle #workout",
  "#fitnessbrasil #treinoemcasa #reeducacaoalimentar #deolhonoshape #hipertrofia #reelsbrasil",
  "#musculacao #fitnessmotivation #gym #treinohoje #disciplina #foco #metas #corpoemente",
];

function cleanFilename(name: string) {
  return name
    .replace(/\.[^.]+$/, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildFallbackCaption(index: number, filename: string, niche: string) {
  const hook = HOOKS[index % HOOKS.length];
  const tags = HASHTAG_SETS[index % HASHTAG_SETS.length];
  const fileHint = cleanFilename(filename);
  const context = fileHint ? ` | tema: ${fileHint}` : "";

  return formatInstagramCaption(
    `${hook}\n\nConteúdo sobre ${niche}${context}.\n💪 Comenta o que achou e salva pra treinar depois.\n\n${tags}`,
  );
}

export function generateFallbackCaptions(params: {
  count: number;
  filenames: string[];
  niche: string;
}) {
  const { count, filenames, niche } = params;
  return Array.from({ length: count }, (_, index) =>
    buildFallbackCaption(index, filenames[index] ?? `video-${index + 1}.mp4`, niche),
  );
}

export async function generateBulkCaptions(params: {
  count: number;
  filenames: string[];
  niche: string;
  username?: string;
  ownerId?: string;
  globalOffset?: number;
}): Promise<{ captions: string[]; source: "ai" | "fallback" }> {
  const globalOffset = params.globalOffset ?? 0;

  if (params.count <= CAPTION_BATCH_SIZE) {
    return generateBulkCaptionsChunk({ ...params, globalOffset });
  }

  const captions: string[] = [];
  let source: "ai" | "fallback" = "ai";

  for (let i = 0; i < params.count; i += CAPTION_BATCH_SIZE) {
    const chunkFilenames = params.filenames.slice(i, i + CAPTION_BATCH_SIZE);
    const chunk = await generateBulkCaptionsChunk({
      count: chunkFilenames.length,
      filenames: chunkFilenames,
      niche: params.niche,
      username: params.username,
      ownerId: params.ownerId,
      globalOffset: globalOffset + i,
    });

    captions.push(...chunk.captions);
    if (chunk.source === "fallback") source = "fallback";
  }

  return { captions, source };
}

async function generateBulkCaptionsChunk(params: {
  count: number;
  filenames: string[];
  niche: string;
  username?: string;
  ownerId?: string;
  globalOffset?: number;
}): Promise<{ captions: string[]; source: "ai" | "fallback" }> {
  const globalOffset = params.globalOffset ?? 0;
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    const niche = params.niche?.trim() || "fitness e lifestyle";
    return {
      captions: Array.from({ length: params.count }, (_, index) =>
        buildFallbackCaption(
          globalOffset + index,
          params.filenames[index] ?? "",
          niche,
        ),
      ),
      source: "fallback",
    };
  }

  const playbook = params.ownerId ? await getPlaybookForOwner(params.ownerId) : null;
  const niche = params.niche?.trim() || playbook?.niche?.trim() || "fitness e lifestyle";

  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0.9,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: buildViralSystemPrompt(playbook, niche),
          },
          {
            role: "user",
            content: buildViralUserPrompt({
              count: params.count,
              filenames: params.filenames,
              niche,
              username: params.username,
            }),
          },
        ],
      }),
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error?.message ?? "Erro na OpenAI");
    }

    const content = data.choices?.[0]?.message?.content ?? "{}";
    const parsed = JSON.parse(content) as { captions?: string[] };
    const captions = (parsed.captions ?? [])
      .map((caption) => formatInstagramCaption(caption.trim()))
      .filter(Boolean)
      .slice(0, params.count);

    while (captions.length < params.count) {
      captions.push(
        buildFallbackCaption(
          globalOffset + captions.length,
          params.filenames[captions.length] ?? "",
          niche,
        ),
      );
    }

    return { captions, source: "ai" };
  } catch {
    return {
      captions: Array.from({ length: params.count }, (_, index) =>
        buildFallbackCaption(
          globalOffset + index,
          params.filenames[index] ?? "",
          niche,
        ),
      ),
      source: "fallback",
    };
  }
}
