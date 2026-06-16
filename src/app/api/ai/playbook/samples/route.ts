import { NextRequest, NextResponse } from "next/server";
import {
  buildPreviewCaptions,
  DEFAULT_CONTENT_FORM,
  formToPlaybook,
  type ContentAssistantForm,
} from "@/lib/ai/playbook-form";
import { buildViralSystemPrompt, buildViralUserPrompt } from "@/lib/ai/playbook";
import { getSessionUserId } from "@/lib/meta/oauth";
import type { AiPlaybook } from "@/lib/types";

const SAMPLE_COUNT = 10;

const SAMPLE_FILENAMES = [
  "treino-peito.mp4",
  "agachamento-forma.mp4",
  "costas-puxada.mp4",
  "abdomen-core.mp4",
  "cardio-queima.mp4",
  "ombro-definicao.mp4",
  "perna-gluteo.mp4",
  "hiit-casa.mp4",
  "mobilidade-stretch.mp4",
  "motivacao-treino.mp4",
];

function normalizeForm(body: Partial<ContentAssistantForm>): ContentAssistantForm {
  return {
    ...DEFAULT_CONTENT_FORM,
    ...body,
    examples: (body.examples ?? DEFAULT_CONTENT_FORM.examples) as ContentAssistantForm["examples"],
    tones: (body.tones ?? DEFAULT_CONTENT_FORM.tones) as ContentAssistantForm["tones"],
    avoid: body.avoid ?? DEFAULT_CONTENT_FORM.avoid,
  };
}

export async function POST(request: NextRequest) {
  const ownerId = await getSessionUserId();
  if (!ownerId) {
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  }

  const form = normalizeForm((await request.json()) as Partial<ContentAssistantForm>);
  const fallback = buildPreviewCaptions(form, SAMPLE_COUNT);
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    return NextResponse.json({
      captions: fallback,
      source: "fallback",
    });
  }

  const playbookPayload = formToPlaybook(form) as AiPlaybook;
  const niche = playbookPayload.niche || "conteúdo digital";

  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0.95,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: `${buildViralSystemPrompt(playbookPayload, niche)}\n\nGere exatamente ${SAMPLE_COUNT} legendas diferentes para mostrar ao usuário como a IA vai escrever nos agendamentos.`,
          },
          {
            role: "user",
            content: buildViralUserPrompt({
              count: SAMPLE_COUNT,
              filenames: SAMPLE_FILENAMES,
              niche,
              username: form.pageName || "perfil",
            }),
          },
        ],
      }),
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error?.message ?? "Erro na OpenAI");

    const content = data.choices?.[0]?.message?.content ?? "{}";
    const parsed = JSON.parse(content) as { captions?: string[] };
    const captions = (parsed.captions ?? [])
      .map((caption) => caption.trim())
      .filter(Boolean)
      .slice(0, SAMPLE_COUNT);

    while (captions.length < SAMPLE_COUNT) {
      captions.push(fallback[captions.length] ?? fallback[0]);
    }

    return NextResponse.json({
      captions,
      source: "ai",
    });
  } catch {
    return NextResponse.json({
      captions: fallback,
      source: "fallback",
    });
  }
}
