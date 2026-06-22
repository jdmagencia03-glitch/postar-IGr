import { NextResponse } from "next/server";
import { formatZodError } from "@/lib/api-errors";
import { requireApiSession } from "@/lib/auth/api-session";
import { dbTimeoutJsonResponse } from "@/lib/api/db-resilience";
import { createAdminClient } from "@/lib/supabase/admin";
import { getOwnerTikTokAccounts } from "@/lib/tiktok/accounts";
import { withTimeoutOrNull, DB_ROUTE_TIMEOUT_MS } from "@/lib/with-timeout";
import { z } from "zod";
import {
  clampWarmupDays,
  DEFAULT_WARMUP_DAYS,
  getWarmupStatus,
} from "@/lib/account-warmup";
import { getOwnerAccounts, getOwnerAccountById, ownerAccountsFilter } from "@/lib/accounts";

function mapAccountResponse(account: Awaited<ReturnType<typeof getOwnerAccounts>>[number]) {
  const warmup = getWarmupStatus({
    warmupEnabled: account.warmup_enabled ?? true,
    warmupStartedAt: account.warmup_started_at ?? account.created_at,
    warmupDays: account.warmup_days ?? DEFAULT_WARMUP_DAYS,
  });

  return {
    id: account.id,
    ig_user_id: account.ig_user_id,
    ig_username: account.ig_username,
    profile_picture_url: account.profile_picture_url,
    auth_provider: account.auth_provider ?? "instagram",
    warmup_enabled: account.warmup_enabled ?? true,
    warmup_days: account.warmup_days ?? DEFAULT_WARMUP_DAYS,
    warmup_started_at: account.warmup_started_at ?? account.created_at,
    warmup,
    created_at: account.created_at,
    updated_at: account.updated_at,
  };
}

const patchSchema = z.object({
  id: z.string().uuid(),
  warmup_enabled: z.boolean().optional(),
  warmup_days: z.number().int().min(2).max(5).optional(),
});

export async function GET() {
  const session = await requireApiSession("api/accounts");
  if (!session.ok) return session.response;
  const ownerId = session.userId;

  const supabase = createAdminClient();
  const accounts = await withTimeoutOrNull(
    getOwnerAccounts(supabase, ownerId),
    DB_ROUTE_TIMEOUT_MS,
    "api-accounts-list",
  );

  if (accounts === null) {
    return dbTimeoutJsonResponse([]);
  }

  return NextResponse.json(accounts.map(mapAccountResponse));
}

export async function PATCH(request: Request) {
  const session = await requireApiSession("api/accounts");
  if (!session.ok) return session.response;
  const ownerId = session.userId;

  const body = await request.json();
  const parsed = patchSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: formatZodError(parsed.error) }, { status: 400 });
  }

  const supabase = createAdminClient();
  const account = await getOwnerAccountById(supabase, ownerId, parsed.data.id);

  if (!account) {
    return NextResponse.json({ error: "Conta não encontrada" }, { status: 404 });
  }

  const updates: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };

  if (parsed.data.warmup_enabled !== undefined) {
    updates.warmup_enabled = parsed.data.warmup_enabled;
    if (parsed.data.warmup_enabled && !account.warmup_started_at) {
      updates.warmup_started_at = new Date().toISOString();
    }
  }

  if (parsed.data.warmup_days !== undefined) {
    updates.warmup_days = clampWarmupDays(parsed.data.warmup_days);
  }

  const { data, error } = await supabase
    .from("instagram_accounts")
    .update(updates)
    .eq("id", parsed.data.id)
    .or(ownerAccountsFilter(ownerId))
    .select("*")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(mapAccountResponse(data));
}

export async function DELETE(request: Request) {
  const session = await requireApiSession("api/accounts");
  if (!session.ok) return session.response;
  const ownerId = session.userId;

  const accountId = new URL(request.url).searchParams.get("id");
  if (!accountId) {
    return NextResponse.json({ error: "ID da conta obrigatório" }, { status: 400 });
  }

  const supabase = createAdminClient();
  const [accounts, tiktokAccounts] = await Promise.all([
    getOwnerAccounts(supabase, ownerId),
    getOwnerTikTokAccounts(supabase, ownerId),
  ]);

  if (accounts.length <= 1 && tiktokAccounts.length === 0) {
    return NextResponse.json(
      { error: "Você precisa manter pelo menos uma conta conectada" },
      { status: 400 },
    );
  }

  const account = await getOwnerAccountById(supabase, ownerId, accountId);
  if (!account) {
    return NextResponse.json({ error: "Conta não encontrada" }, { status: 404 });
  }

  const { error } = await supabase
    .from("instagram_accounts")
    .delete()
    .eq("id", accountId)
    .or(ownerAccountsFilter(ownerId));

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
