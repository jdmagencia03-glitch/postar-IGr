import type { SupabaseClient } from "@supabase/supabase-js";
import type { Product, ProductStatus } from "@/lib/types";

export const CAMPAIGN_OBJECTIVE_LABELS: Record<string, string> = {
  sell_product: "Vender produto",
  generate_leads: "Gerar leads",
  bio_traffic: "Levar para bio",
  whatsapp: "Levar para WhatsApp",
  dm: "Levar para DM",
  warm_audience: "Aquecer audiência",
  grow_followers: "Crescer seguidores",
  test_offer: "Testar oferta",
  remarketing: "Remarketing",
};

export async function listOwnerProducts(
  supabase: SupabaseClient,
  ownerId: string,
  status?: ProductStatus | "all",
) {
  let query = supabase
    .from("products")
    .select("*")
    .eq("owner_id", ownerId)
    .order("updated_at", { ascending: false });

  if (status && status !== "all") {
    query = query.eq("status", status);
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []) as Product[];
}

export async function getOwnerProduct(
  supabase: SupabaseClient,
  ownerId: string,
  productId: string,
) {
  const { data, error } = await supabase
    .from("products")
    .select("*")
    .eq("owner_id", ownerId)
    .eq("id", productId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return (data as Product | null) ?? null;
}

export function productInputFromBody(body: Record<string, unknown>) {
  return {
    name: String(body.name ?? "").trim(),
    niche: body.niche ? String(body.niche).trim() : null,
    description: body.description ? String(body.description).trim() : null,
    price: body.price != null && body.price !== "" ? Number(body.price) : null,
    checkout_url: body.checkout_url ? String(body.checkout_url).trim() : null,
    sales_page_url: body.sales_page_url ? String(body.sales_page_url).trim() : null,
    whatsapp_url: body.whatsapp_url ? String(body.whatsapp_url).trim() : null,
    bio_url: body.bio_url ? String(body.bio_url).trim() : null,
    main_cta: body.main_cta ? String(body.main_cta).trim() : null,
    comment_keyword: body.comment_keyword ? String(body.comment_keyword).trim() : null,
    dm_message: body.dm_message ? String(body.dm_message).trim() : null,
    coupon: body.coupon ? String(body.coupon).trim() : null,
    status: (body.status === "paused" ? "paused" : "active") as ProductStatus,
    notes: body.notes ? String(body.notes).trim() : null,
    updated_at: new Date().toISOString(),
  };
}
