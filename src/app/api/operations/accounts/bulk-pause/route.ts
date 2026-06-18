import { NextRequest, NextResponse } from "next/server";
import { formatZodError } from "@/lib/api-errors";
import { getSessionUserId } from "@/lib/meta/oauth";
import { createAdminClient } from "@/lib/supabase/admin";
import { z } from "zod";

const bodySchema = z.object({
  accounts: z
    .array(
      z.object({
        id: z.string().uuid(),
        platform: z.enum(["instagram", "tiktok"]),
      }),
    )
    .min(1)
    .max(50),
  paused: z.boolean(),
});

export async function POST(request: NextRequest) {
  const ownerId = await getSessionUserId();
  if (!ownerId) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const body = await request.json();
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: formatZodError(parsed.error) }, { status: 400 });
  }

  const supabase = createAdminClient();
  let updated = 0;
  const errors: string[] = [];

  for (const account of parsed.data.accounts) {
    const table = account.platform === "tiktok" ? "tiktok_accounts" : "instagram_accounts";
    const { error } = await supabase
      .from(table)
      .update({
        publishing_paused: parsed.data.paused,
        updated_at: new Date().toISOString(),
      })
      .eq("id", account.id)
      .eq("owner_id", ownerId);

    if (error) errors.push(`${account.id}: ${error.message}`);
    else updated++;
  }

  await supabase.from("security_audit_logs").insert({
    owner_id: ownerId,
    event_type: parsed.data.paused ? "accounts_bulk_paused" : "accounts_bulk_resumed",
    metadata: { count: updated, account_ids: parsed.data.accounts.map((a) => a.id) },
  });

  return NextResponse.json({
    updated,
    paused: parsed.data.paused,
    errors,
    message: parsed.data.paused
      ? `${updated} conta(s) pausada(s). Posts permanecem salvos.`
      : `${updated} conta(s) com publicações retomadas.`,
  });
}
