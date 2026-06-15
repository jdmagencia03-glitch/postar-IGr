import { NextRequest, NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/meta/oauth";

export async function POST(request: NextRequest) {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  }

  const { topic, tone } = await request.json();
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    return NextResponse.json(
      { error: "OPENAI_API_KEY não configurada" },
      { status: 503 },
    );
  }

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content:
            "Você escreve legendas para Instagram em português do Brasil. Retorne 3 variações separadas por '---'. Inclua emojis moderados e hashtags relevantes.",
        },
        {
          role: "user",
          content: `Tema: ${topic ?? "post do dia"}. Tom: ${tone ?? "casual"}.`,
        },
      ],
      temperature: 0.8,
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
