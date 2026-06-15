import { NextRequest, NextResponse } from "next/server";
import {
  buildViralSystemPrompt,
  buildViralUserPrompt,
  getPlaybookForOwner,
} from "@/lib/ai/playbook";
import { getSessionUserId } from "@/lib/meta/oauth";

export async function POST(request: NextRequest) {
  const ownerId = await getSessionUserId();
  if (!ownerId) {
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  }

  const { topic, tone, username } = await request.json();
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    return NextResponse.json(
      { error: "OPENAI_API_KEY não configurada" },
      { status: 503 },
    );
  }

  const playbook = await getPlaybookForOwner(ownerId);
  const niche = topic?.trim() || playbook?.niche?.trim() || "post do dia";

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      temperature: 0.9,
      messages: [
        {
          role: "system",
          content: `${buildViralSystemPrompt(playbook, niche)}\n\nGere 3 variações separadas por '---'.`,
        },
        {
          role: "user",
          content: `${buildViralUserPrompt({
            count: 3,
            filenames: ["post-teste.mp4"],
            niche,
            username,
          })}\nTom extra: ${tone ?? "casual"}.`,
        },
      ],
    }),
  });

  const data = await res.json();

  if (!res.ok) {
    return NextResponse.json(
      { error: data.error?.message ?? "Erro na OpenAI" },
      { status: 500 },
    );
  }

  const text = data.choices?.[0]?.message?.content ?? "";
  const captions = text
    .split("---")
    .map((c: string) => c.trim())
    .filter(Boolean);

  return NextResponse.json({ captions });
}
