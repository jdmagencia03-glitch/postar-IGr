import { NextRequest, NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/meta/oauth";
import {
  campaignInputFromBody,
  getOwnerCampaign,
  syncCampaignAccounts,
} from "@/lib/campaigns/campaigns";
import { createAdminClient } from "@/lib/supabase/admin";
import type { SocialPlatform } from "@/lib/types";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ownerId = await getSessionUserId();
  if (!ownerId) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const { id } = await params;
  const supabase = createAdminClient();
  const campaign = await getOwnerCampaign(supabase, ownerId, id);

  if (!campaign) return NextResponse.json({ error: "Campanha não encontrada" }, { status: 404 });
  return NextResponse.json(campaign);
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ownerId = await getSessionUserId();
  if (!ownerId) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const { id } = await params;
  const supabase = createAdminClient();
  const existing = await getOwnerCampaign(supabase, ownerId, id);
  if (!existing) return NextResponse.json({ error: "Campanha não encontrada" }, { status: 404 });

  const body = await request.json();
  const input = campaignInputFromBody({ ...existing, ...body });

  const { data, error } = await supabase
    .from("campaigns")
    .update(input)
    .eq("id", id)
    .select("*")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  if (Array.isArray(body.accounts)) {
    await syncCampaignAccounts(
      supabase,
      id,
      body.accounts as Array<{ account_id: string; platform: SocialPlatform; content_types?: string[] }>,
    );
  }

  const updated = await getOwnerCampaign(supabase, ownerId, id);
  return NextResponse.json(updated ?? data);
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ownerId = await getSessionUserId();
  if (!ownerId) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const { id } = await params;
  const supabase = createAdminClient();
  const existing = await getOwnerCampaign(supabase, ownerId, id);
  if (!existing) return NextResponse.json({ error: "Campanha não encontrada" }, { status: 404 });

  const { error } = await supabase.from("campaigns").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
