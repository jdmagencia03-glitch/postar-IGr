import {
  buildViralSystemPrompt,
  buildViralUserPrompt,
  getPlaybookForAccount,
  resolveNicheFromPlaybook,
} from "@/lib/ai/playbook";
import { formatInstagramCaption } from "@/lib/ai/caption-format";
import { logCaptionGeneration } from "@/lib/ai/caption-debug";
import { CAPTION_BATCH_SIZE } from "@/lib/autopilot-constants";

function cleanFilename(name: string) {
  return name
    .replace(/\.[^.]+$/, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function nicheTag(niche: string) {
  const slug = niche
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "");
  return slug ? `#${slug}` : "#reels";
}

function buildFallbackCaption(index: number, filename: string, niche: string) {
  const hooks = [
    `Conteúdo sobre ${niche} que você precisa ver`,
    `Dica rápida de ${niche} para salvar agora`,
    `Mais um Reel de ${niche} no feed`,
    `Isso aqui é puro ${niche} — assiste até o fim`,
  ];
  const hook = hooks[index % hooks.length];
  const fileHint = cleanFilename(filename);
  const context = fileHint ? ` | tema: ${fileHint}` : "";
  const tags = `${nicheTag(niche)} #reels #fyp #viral #brasil`;

  return formatInstagramCaption(
    `${hook}${context}.\n\nComenta o que achou e salva pra ver depois.\n\n${tags}`,
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
  niche?: string;
  username?: string;
  ownerId?: string;
  accountId?: string;
  globalOffset?: number;
}): Promise<{ captions: string[]; source: "ai" | "fallback"; niche: string; debug?: Record<string, unknown> }> {
  const globalOffset = params.globalOffset ?? 0;

  if (params.count <= CAPTION_BATCH_SIZE) {
    return generateBulkCaptionsChunk({ ...params, globalOffset });
  }

  const captions: string[] = [];
  let source: "ai" | "fallback" = "ai";
  let niche = "conteúdo digital";

  for (let i = 0; i < params.count; i += CAPTION_BATCH_SIZE) {
    const chunkFilenames = params.filenames.slice(i, i + CAPTION_BATCH_SIZE);
    const chunk = await generateBulkCaptionsChunk({
      count: chunkFilenames.length,
      filenames: chunkFilenames,
      niche: params.niche,
      username: params.username,
      ownerId: params.ownerId,
      accountId: params.accountId,
      globalOffset: globalOffset + i,
    });

    captions.push(...chunk.captions);
    niche = chunk.niche;
    if (chunk.source === "fallback") source = "fallback";
  }

  return { captions, source, niche };
}

async function generateBulkCaptionsChunk(params: {
  count: number;
  filenames: string[];
  niche?: string;
  username?: string;
  ownerId?: string;
  accountId?: string;
  globalOffset?: number;
}): Promise<{ captions: string[]; source: "ai" | "fallback"; niche: string; debug?: Record<string, unknown> }> {
  const globalOffset = params.globalOffset ?? 0;

  const playbook =
    params.ownerId && params.accountId
      ? await getPlaybookForAccount(params.ownerId, params.accountId)
      : null;
  const niche = resolveNicheFromPlaybook(playbook, params.niche);

  const systemPrompt = buildViralSystemPrompt(playbook, niche);
  const userPrompt = buildViralUserPrompt({
    count: params.count,
    filenames: params.filenames,
    niche,
    username: params.username,
  });

  const debugBase = {
    accountId: params.accountId ?? null,
    accountName: params.username ?? null,
    niche,
    ownerId: params.ownerId ?? null,
    count: params.count,
    playbookLoaded: Boolean(playbook),
    playbookNiche: playbook?.niche ?? null,
    playbookBrand: playbook?.brand_name ?? null,
  };

  logCaptionGeneration("start", {
    ...debugBase,
    systemPromptPreview: systemPrompt.slice(0, 500),
    userPromptPreview: userPrompt.slice(0, 500),
  });

  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    logCaptionGeneration("fallback_no_api_key", debugBase);
    return {
      captions: Array.from({ length: params.count }, (_, index) =>
        buildFallbackCaption(globalOffset + index, params.filenames[index] ?? "", niche),
      ),
      source: "fallback",
      niche,
      debug: debugBase,
    };
  }

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
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
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

    logCaptionGeneration("success", {
      ...debugBase,
      generatedCount: captions.length,
      finalPromptUser: userPrompt,
      finalPromptSystem: systemPrompt,
    });

    return { captions, source: "ai", niche, debug: debugBase };
  } catch (error) {
    logCaptionGeneration("fallback_error", {
      ...debugBase,
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      captions: Array.from({ length: params.count }, (_, index) =>
        buildFallbackCaption(globalOffset + index, params.filenames[index] ?? "", niche),
      ),
      source: "fallback",
      niche,
      debug: debugBase,
    };
  }
}
