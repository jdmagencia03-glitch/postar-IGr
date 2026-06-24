import { NextRequest, NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/meta/oauth";
import { campaignPatchSchema } from "@/lib/api/schemas/campaigns";
import { parseJsonBody, parseRouteId } from "@/lib/api/validate-request";
import {
  campaignInputFromBody,
  getOwnerCampaign,
  syncCampaignAccounts,
} from "@/lib/campaigns/campaigns";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ownerId = await getSessionUserId();
  if (!ownerId) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const idParsed = await parseRouteId(params);
  if (!idParsed.ok) return idParsed.response;

  const supabase = createAdminClient();
  const campaign = await getOwnerCampaign(supabase, ownerId, idParsed.data);

  if (!campaign) return NextResponse.json({ error: "Campanha não encontrada" }, { status: 404 });
  return NextResponse.json(campaign);
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ownerId = await getSessionUserId();
  if (!ownerId) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const idParsed = await parseRouteId(params);
  if (!idParsed.ok) return idParsed.response;

  const supabase = createAdminClient();
  const existing = await getOwnerCampaign(supabase, ownerId, idParsed.data);
  if (!existing) return NextResponse.json({ error: "Campanha não encontrada" }, { status: 404 });

  const parsed = await parseJsonBody(request, campaignPatchSchema);
  if (!parsed.ok) return parsed.response;

  const { accounts, ...body } = parsed.data;
  const input = campaignInputFromBody({ ...existing, ...body });

  const { data, error } = await supabase
    .from("campaigns")
    .update(input)
    .eq("id", idParsed.data)
    .select("*")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  if (accounts) {
    await syncCampaignAccounts(supabase, idParsed.data, accounts);
  }

  const updated = await getOwnerCampaign(supabase, ownerId, idParsed.data);
  return NextResponse.json(updated ?? data);
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ownerId = await getSessionUserId();
  if (!ownerId) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const idParsed = await parseRouteId(params);
  if (!idParsed.ok) return idParsed.response;

  const supabase = createAdminClient();
  const existing = await getOwnerCampaign(supabase, ownerId, idParsed.data);
  if (!existing) return NextResponse.json({ error: "Campanha não encontrada" }, { status: 404 });

  const { error } = await supabase.from("campaigns").delete().eq("id", idParsed.data);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
