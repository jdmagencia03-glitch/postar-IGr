import { NextRequest, NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/meta/oauth";
import {
  campaignInputFromBody,
  listOwnerCampaigns,
  syncCampaignAccounts,
} from "@/lib/campaigns/campaigns";
import { createAdminClient } from "@/lib/supabase/admin";
import type { SocialPlatform } from "@/lib/types";

export async function GET(request: NextRequest) {
  const ownerId = await getSessionUserId();
  if (!ownerId) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const status = request.nextUrl.searchParams.get("status") ?? "all";
  const supabase = createAdminClient();

  try {
    const campaigns = await listOwnerCampaigns(
      supabase,
      ownerId,
      status === "active" || status === "paused" || status === "finished" ? status : "all",
    );
    return NextResponse.json({ campaigns });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Erro ao listar campanhas" },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  const ownerId = await getSessionUserId();
  if (!ownerId) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const body = await request.json();
  const input = campaignInputFromBody(body);
  if (!input.name) {
    return NextResponse.json({ error: "Nome da campanha é obrigatório" }, { status: 400 });
  }

  const accounts = (body.accounts ?? []) as Array<{
    account_id: string;
    platform: SocialPlatform;
    content_types?: string[];
  }>;

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("campaigns")
    .insert({ ...input, owner_id: ownerId })
    .select("*")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  if (accounts.length) {
    await syncCampaignAccounts(supabase, data.id, accounts);
  }

  const campaign = await listOwnerCampaigns(supabase, ownerId);
  const created = campaign.find((c) => c.id === data.id);
  return NextResponse.json(created ?? data, { status: 201 });
}
