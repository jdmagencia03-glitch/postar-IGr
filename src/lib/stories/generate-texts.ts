import { getPlaybookForAccount, resolveNicheFromPlaybook, buildPlaybookContext } from "@/lib/ai/playbook";
import { logCaptionGeneration } from "@/lib/ai/caption-debug";
import type { StoryCtaOption, StoryObjective } from "@/lib/stories/types";

function fallbackStoryText(params: {
  niche: string;
  objective: string;
  cta: string;
  filename: string;
  index: number;
}) {
  const hooks = [
    `Conteúdo de ${params.niche} que você precisa ver hoje.`,
    `Dica rápida para quem curte ${params.niche}.`,
    `Story pensado para ${params.objective.toLowerCase()}.`,
  ];
  return `${hooks[params.index % hooks.length]}\n\n${params.cta}`;
}

export async function generateStoryTexts(params: {
  count: number;
  filenames: string[];
  ownerId: string;
  accountId: string;
  username: string;
  storyObjective: string;
  storyCta: string;
  storyLink?: string | null;
}) {
  const playbook = await getPlaybookForAccount(params.ownerId, params.accountId);
  const niche = resolveNicheFromPlaybook(playbook);
  const apiKey = process.env.OPENAI_API_KEY;

  const debugBase = {
    accountId: params.accountId,
    accountName: params.username,
    niche,
    contentType: "story",
    count: params.count,
    storyObjective: params.storyObjective,
    storyCta: params.storyCta,
  };

  if (!apiKey) {
    logCaptionGeneration("story_fallback_no_api", debugBase);
    return {
      texts: Array.from({ length: params.count }, (_, index) =>
        fallbackStoryText({
          niche,
          objective: params.storyObjective,
          cta: params.storyCta,
          filename: params.filenames[index] ?? "",
          index,
        }),
      ),
      niche,
      source: "fallback" as const,
    };
  }

  const playbookContext = buildPlaybookContext(playbook, niche);
  const fileList = params.filenames
    .map((name, index) => `${index + 1}. ${name.replace(/\.[^.]+$/, "")}`)
    .join("\n");

  const systemPrompt = `Você escreve textos curtos para Instagram Stories no Brasil.
Regras:
- Texto curto (máx. 220 caracteres por story)
- Tom natural, direto, conversão
- Objetivo do story: ${params.storyObjective}
- CTA obrigatório: ${params.storyCta}
${params.storyLink ? `- Link de referência: ${params.storyLink}` : ""}
- Nicho: ${niche}
- Use o playbook da marca abaixo

PLAYBOOK:
${playbookContext}

Retorne JSON: {"texts":["story 1","story 2",...]}`;

  const userPrompt = `Crie exatamente ${params.count} textos curtos para Stories da conta @${params.username}.

Arquivos:
${fileList}

Cada texto deve ter 1-3 linhas curtas + o CTA. Sem hashtags longas.`;

  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0.85,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      }),
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error?.message ?? "Erro na OpenAI");

    const parsed = JSON.parse(data.choices?.[0]?.message?.content ?? "{}") as { texts?: string[] };
    const texts = (parsed.texts ?? [])
      .map((text) => text.trim())
      .filter(Boolean)
      .slice(0, params.count);

    while (texts.length < params.count) {
      texts.push(
        fallbackStoryText({
          niche,
          objective: params.storyObjective,
          cta: params.storyCta,
          filename: params.filenames[texts.length] ?? "",
          index: texts.length,
        }),
      );
    }

    logCaptionGeneration("story_success", {
      ...debugBase,
      generatedCount: texts.length,
      systemPromptPreview: systemPrompt.slice(0, 400),
      userPromptPreview: userPrompt.slice(0, 400),
    });

    return { texts, niche, source: "ai" as const };
  } catch (error) {
    logCaptionGeneration("story_fallback_error", {
      ...debugBase,
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      texts: Array.from({ length: params.count }, (_, index) =>
        fallbackStoryText({
          niche,
          objective: params.storyObjective,
          cta: params.storyCta,
          filename: params.filenames[index] ?? "",
          index,
        }),
      ),
      niche,
      source: "fallback" as const,
    };
  }
}

export function normalizeStoryObjective(value: string): StoryObjective | string {
  return value.trim();
}

export function normalizeStoryCta(value: string): StoryCtaOption | string {
  return value.trim();
}
