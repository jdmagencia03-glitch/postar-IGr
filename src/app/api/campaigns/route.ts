import { NextRequest, NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/meta/oauth";
import { campaignListStatusSchema } from "@/lib/api/schemas/common";
import { campaignBodySchema, campaignPatchSchema } from "@/lib/api/schemas/campaigns";
import { parseJsonBody, parseSearchParams } from "@/lib/api/validate-request";
import {
  campaignInputFromBody,
  listOwnerCampaigns,
  syncCampaignAccounts,
  getOwnerCampaign,
} from "@/lib/campaigns/campaigns";
import { createAdminClient } from "@/lib/supabase/admin";
import { z } from "zod";

const listQuerySchema = z.object({
  status: campaignListStatusSchema,
});

export async function GET(request: NextRequest) {
  const ownerId = await getSessionUserId();
  if (!ownerId) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const query = parseSearchParams(request.nextUrl.searchParams, listQuerySchema);
  if (!query.ok) return query.response;

  const supabase = createAdminClient();

  try {
    const campaigns = await listOwnerCampaigns(
      supabase,
      ownerId,
      query.data.status === "all" ? "all" : query.data.status,
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

  const parsed = await parseJsonBody(request, campaignBodySchema);
  if (!parsed.ok) return parsed.response;

  const { accounts, ...body } = parsed.data;
  const input = campaignInputFromBody(body);

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("campaigns")
    .insert({ ...input, owner_id: ownerId })
    .select("*")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  if (accounts?.length) {
    await syncCampaignAccounts(supabase, data.id, accounts);
  }

  const campaign = await getOwnerCampaign(supabase, ownerId, data.id);
  return NextResponse.json(campaign ?? data, { status: 201 });
}
