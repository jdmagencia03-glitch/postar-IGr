import { NextRequest, NextResponse } from "next/server";
import {
  buildPreviewCaption,
  DEFAULT_CONTENT_FORM,
  formToPlaybook,
  type ContentAssistantForm,
} from "@/lib/ai/playbook-form";
import { buildViralSystemPrompt, buildViralUserPrompt } from "@/lib/ai/playbook";
import { getSessionUserId } from "@/lib/meta/oauth";
import type { AiPlaybook } from "@/lib/types";

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

  const body = (await request.json()) as Partial<ContentAssistantForm> & { seed?: number };
  const form = normalizeForm(body);
  const seed = typeof body.seed === "number" ? body.seed : 0;

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({
      caption: buildPreviewCaption(form, seed),
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
        temperature: 0.85,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: `${buildViralSystemPrompt(playbookPayload, niche)}\n\nGere apenas 1 legenda de exemplo no estilo configurado pelo usuário.`,
          },
          {
            role: "user",
            content: buildViralUserPrompt({
              count: 1,
              filenames: ["exemplo-reel.mp4"],
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
    const caption = parsed.captions?.[0]?.trim();

    return NextResponse.json({
      caption: caption || buildPreviewCaption(form, seed),
      source: caption ? "ai" : "fallback",
    });
  } catch {
    return NextResponse.json({
      caption: buildPreviewCaption(form, seed),
      source: "fallback",
    });
  }
}
