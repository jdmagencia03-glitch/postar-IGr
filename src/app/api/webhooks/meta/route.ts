import { NextRequest, NextResponse } from "next/server";
import { handleWebhookComment } from "@/lib/comment-dm/processor";
import { metaWebhookBodySchema } from "@/lib/api/schemas/webhooks";
import { parseJsonBody } from "@/lib/api/validate-request";
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

export async function POST(request: NextRequest) {
  const parsed = await parseJsonBody(request, metaWebhookBodySchema);
  if (!parsed.ok) return parsed.response;

  const body = parsed.data;
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
