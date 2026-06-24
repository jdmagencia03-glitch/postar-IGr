import { NextRequest, NextResponse } from "next/server";
import {
  buildViralSystemPrompt,
  buildViralUserPrompt,
  getPlaybookForOwner,
} from "@/lib/ai/playbook";
import { captionGenerateSchema } from "@/lib/api/schemas/captions";
import { parseJsonBody } from "@/lib/api/validate-request";
import { requireAuthenticatedApi } from "@/lib/security/api";
import { RATE_LIMIT_AI } from "@/lib/security/rate-limit-config";

const AI_RATE_WINDOW_MS = 60_000;

export async function POST(request: NextRequest) {
  const auth = await requireAuthenticatedApi(request, {
    rateLimit: { scope: "ai-captions", limit: RATE_LIMIT_AI, windowMs: AI_RATE_WINDOW_MS },
  });
  if (auth.response) return auth.response;

  const parsed = await parseJsonBody(request, captionGenerateSchema);
  if (!parsed.ok) return parsed.response;

  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    return NextResponse.json(
      { error: "OPENAI_API_KEY não configurada" },
      { status: 503 },
    );
  }

  const playbook = await getPlaybookForOwner(auth.userId);
  const niche = parsed.data.topic?.trim() || playbook?.niche?.trim() || "post do dia";

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
            username: parsed.data.username,
          })}\nTom extra: ${parsed.data.tone ?? "casual"}.`,
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
