import { NextRequest, NextResponse } from "next/server";
import { handleWebhookComment } from "@/lib/comment-dm/processor";
import { createAdminClient } from "@/lib/supabase/admin";

export const maxDuration = 60;

function getVerifyToken() {
  return process.env.META_WEBHOOK_VERIFY_TOKEN ?? "";
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const mode = params.get("hub.mode");
  const token = params.get("hub.verify_token");
  const challenge = params.get("hub.challenge");

  const verifyToken = getVerifyToken();

  if (mode === "subscribe" && token && verifyToken && token === verifyToken && challenge) {
    return new NextResponse(challenge, { status: 200 });
  }

  return NextResponse.json({ error: "Verificação inválida" }, { status: 403 });
}

type WebhookCommentValue = {
  id: string;
  text?: string;
  from?: { id?: string; username?: string };
  media?: { id?: string };
  timestamp?: string;
};

type WebhookEntry = {
  id: string;
  changes?: Array<{ field?: string; value?: WebhookCommentValue }>;
};

export async function POST(request: NextRequest) {
  let body: { object?: string; entry?: WebhookEntry[] };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Payload inválido" }, { status: 400 });
  }

  if (body.object !== "instagram" || !body.entry?.length) {
    return NextResponse.json({ received: true });
  }

  const supabase = createAdminClient();
  const results: unknown[] = [];

  for (const entry of body.entry) {
    const igUserId = entry.id;

    for (const change of entry.changes ?? []) {
      if (change.field !== "comments" && change.field !== "live_comments") continue;
      const value = change.value;
      if (!value?.id) continue;

      const result = await handleWebhookComment(supabase, igUserId, value);
      results.push(result);
    }
  }

  return NextResponse.json({ received: true, processed: results.length, results });
}
