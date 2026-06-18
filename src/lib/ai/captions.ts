import {
  buildViralSystemPrompt,
  buildViralUserPrompt,
  getPlaybookForAccount,
  resolveNicheFromPlaybook,
  buildPlaybookContext,
} from "@/lib/ai/playbook";
import { buildCampaignPromptContext } from "@/lib/campaigns/context";
import { formatInstagramCaption, formatTikTokCaption } from "@/lib/ai/caption-format";
import { logCaptionGeneration } from "@/lib/ai/caption-debug";
import { CAPTION_BATCH_SIZE } from "@/lib/autopilot-constants";
import type { CampaignContext, ContentType, SocialPlatform } from "@/lib/types";

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

function buildFallbackCaption(
  index: number,
  filename: string,
  niche: string,
  platform: SocialPlatform = "instagram",
) {
  if (platform === "tiktok") {
    const hooks = [
      `Isso sobre ${niche} vai te surpreender`,
      `Dica rápida de ${niche} que você precisa ver`,
      `Salva esse conteúdo de ${niche}`,
    ];
    const hook = hooks[index % hooks.length];
    const tags = `#fyp #foryou #viral #${niche.replace(/\s+/g, "").slice(0, 20)} #brasil`;
    return formatTikTokCaption(`${hook}. Comenta o que achou!\n\n${tags}`);
  }

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
  platform?: SocialPlatform;
}) {
  const { count, filenames, niche, platform = "instagram" } = params;
  return Array.from({ length: count }, (_, index) =>
    buildFallbackCaption(index, filenames[index] ?? `video-${index + 1}.mp4`, niche, platform),
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
  platform?: SocialPlatform;
  contentType?: ContentType;
  campaignContext?: CampaignContext | null;
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
      platform: params.platform,
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
  platform?: SocialPlatform;
  contentType?: ContentType;
  campaignContext?: CampaignContext | null;
}): Promise<{ captions: string[]; source: "ai" | "fallback"; niche: string; debug?: Record<string, unknown> }> {
  const globalOffset = params.globalOffset ?? 0;
  const platform = params.platform ?? "instagram";
  const contentType = params.contentType ?? (platform === "tiktok" ? "tiktok_video" : "reel");

  const playbook =
    params.ownerId && params.accountId
      ? await getPlaybookForAccount(params.ownerId, params.accountId)
      : null;
  const niche = resolveNicheFromPlaybook(playbook, params.niche);

  const campaignBlock = params.campaignContext
    ? `\n\n${buildCampaignPromptContext(params.campaignContext, platform, contentType)}`
    : "";

  const systemPrompt =
    (platform === "tiktok"
      ? buildTikTokSystemPrompt(playbook, niche)
      : buildViralSystemPrompt(playbook, niche)) + campaignBlock;
  const userPrompt =
    platform === "tiktok"
      ? buildTikTokUserPrompt({
          count: params.count,
          filenames: params.filenames,
          niche,
          username: params.username,
        })
      : buildViralUserPrompt({
          count: params.count,
          filenames: params.filenames,
          niche,
          username: params.username,
        });

  const debugBase = {
    accountId: params.accountId ?? null,
    accountName: params.username ?? null,
    niche,
    platform,
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
        buildFallbackCaption(globalOffset + index, params.filenames[index] ?? "", niche, platform),
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
    const formatCaption = platform === "tiktok" ? formatTikTokCaption : formatInstagramCaption;
    const captions = (parsed.captions ?? [])
      .map((caption) => formatCaption(caption.trim()))
      .filter(Boolean)
      .slice(0, params.count);

    while (captions.length < params.count) {
      captions.push(
        buildFallbackCaption(
          globalOffset + captions.length,
          params.filenames[captions.length] ?? "",
          niche,
          platform,
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
        buildFallbackCaption(globalOffset + index, params.filenames[index] ?? "", niche, platform),
      ),
      source: "fallback",
      niche,
      debug: debugBase,
    };
  }
}

function buildTikTokSystemPrompt(
  playbook: Awaited<ReturnType<typeof getPlaybookForAccount>>,
  fallbackNiche: string,
) {
  const playbookContext = buildPlaybookContext(playbook, fallbackNiche);

  return `Você escreve legendas curtas para TikTok no Brasil, focadas em descoberta (FYP).

PLAYBOOK DA MARCA:
${playbookContext || `Nicho: ${fallbackNiche}.`}

REGRAS TIKTOK:
- Legenda curta (máx. 180 caracteres no corpo, antes das hashtags)
- Gancho direto na primeira frase
- CTA simples (comenta, salva, segue)
- 4-6 hashtags de descoberta (#fyp #foryou + nicho)
- Tom natural, sem parecer anúncio
- Cada legenda única

Retorne JSON: {"captions":["legenda 1","legenda 2",...]}`;
}

function buildTikTokUserPrompt(params: {
  count: number;
  filenames: string[];
  niche: string;
  username?: string;
}) {
  const fileList = params.filenames
    .map((name, index) => `${index + 1}. ${name.replace(/\.[^.]+$/, "")}`)
    .join("\n");

  return `Crie exatamente ${params.count} legendas para TikTok da conta @${params.username ?? "perfil"}.
Nicho: ${params.niche}

Vídeos:
${fileList}

Cada legenda: 1-2 frases curtas + hashtags de descoberta.`;
}
