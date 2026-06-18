import type { SupabaseClient } from "@supabase/supabase-js";
import type { Campaign, CampaignObjective, CampaignStatus, SocialPlatform } from "@/lib/types";
import { CAMPAIGN_OBJECTIVE_LABELS } from "@/lib/products/products";

export { CAMPAIGN_OBJECTIVE_LABELS };

export async function listOwnerCampaigns(
  supabase: SupabaseClient,
  ownerId: string,
  status?: CampaignStatus | "all",
) {
  let query = supabase
    .from("campaigns")
    .select("*, products(id, name, main_cta, comment_keyword), campaign_accounts(*)")
    .eq("owner_id", ownerId)
    .order("updated_at", { ascending: false });

  if (status && status !== "all") {
    query = query.eq("status", status);
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []) as Campaign[];
}

export async function getOwnerCampaign(
  supabase: SupabaseClient,
  ownerId: string,
  campaignId: string,
) {
  const { data, error } = await supabase
    .from("campaigns")
    .select("*, products(*), campaign_accounts(*)")
    .eq("owner_id", ownerId)
    .eq("id", campaignId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return (data as Campaign | null) ?? null;
}

export function campaignInputFromBody(body: Record<string, unknown>) {
  return {
    product_id: body.product_id ? String(body.product_id) : null,
    name: String(body.name ?? "").trim(),
    niche: body.niche ? String(body.niche).trim() : null,
    objective: (body.objective ? String(body.objective) : "sell_product") as CampaignObjective,
    default_cta: body.default_cta ? String(body.default_cta).trim() : null,
    comment_keyword: body.comment_keyword ? String(body.comment_keyword).trim() : null,
    dm_message: body.dm_message ? String(body.dm_message).trim() : null,
    main_link: body.main_link ? String(body.main_link).trim() : null,
    posts_per_day: Number(body.posts_per_day ?? 0),
    stories_per_day: Number(body.stories_per_day ?? 0),
    starts_at: body.starts_at ? String(body.starts_at) : null,
    ends_at: body.ends_at ? String(body.ends_at) : null,
    status: (["active", "paused", "finished"].includes(String(body.status))
      ? body.status
      : "active") as CampaignStatus,
    notes: body.notes ? String(body.notes).trim() : null,
    updated_at: new Date().toISOString(),
  };
}

export async function syncCampaignAccounts(
  supabase: SupabaseClient,
  campaignId: string,
  accounts: Array<{ account_id: string; platform: SocialPlatform; content_types?: string[] }>,
) {
  await supabase.from("campaign_accounts").delete().eq("campaign_id", campaignId);

  if (!accounts.length) return;

  const rows = accounts.map((row) => ({
    campaign_id: campaignId,
    account_id: row.account_id,
    platform: row.platform,
    content_types: row.content_types ?? [],
  }));

  const { error } = await supabase.from("campaign_accounts").insert(rows);
  if (error) throw new Error(error.message);
}

export async function resolveCampaignContext(
  supabase: SupabaseClient,
  ownerId: string,
  params: { productId?: string | null; campaignId?: string | null; contentObjective?: string | null },
) {
  let product = null;
  let campaign = null;

  if (params.campaignId) {
    campaign = await getOwnerCampaign(supabase, ownerId, params.campaignId);
    if (campaign?.product_id && campaign.products) {
      product = campaign.products as unknown as import("@/lib/types").Product;
    }
  }

  if (params.productId) {
    const { getOwnerProduct } = await import("@/lib/products/products");
    product = await getOwnerProduct(supabase, ownerId, params.productId);
  }

  return {
    product,
    campaign,
    contentObjective: params.contentObjective ?? campaign?.objective ?? null,
  };
}
