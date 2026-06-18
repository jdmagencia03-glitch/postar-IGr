import type { CampaignContext, ContentType, SocialPlatform } from "@/lib/types";
import { CAMPAIGN_OBJECTIVE_LABELS } from "@/lib/campaigns/campaigns";

export function buildCampaignPromptContext(
  ctx: CampaignContext,
  platform: SocialPlatform = "instagram",
  contentType: ContentType = "reel",
) {
  const sections: string[] = [];

  if (ctx.product) {
    sections.push(`PRODUTO/OFFERTA:
Nome: ${ctx.product.name}
${ctx.product.niche ? `Nicho: ${ctx.product.niche}` : ""}
${ctx.product.description ? `Descrição: ${ctx.product.description}` : ""}
${ctx.product.price != null ? `Preço: R$ ${ctx.product.price}` : ""}
${ctx.product.main_cta ? `CTA principal: ${ctx.product.main_cta}` : ""}
${ctx.product.comment_keyword ? `Palavra-chave de comentário: ${ctx.product.comment_keyword}` : ""}
${ctx.product.checkout_url ? `Checkout: ${ctx.product.checkout_url}` : ""}
${ctx.product.bio_url ? `Bio: ${ctx.product.bio_url}` : ""}
${ctx.product.whatsapp_url ? `WhatsApp: ${ctx.product.whatsapp_url}` : ""}
${ctx.product.coupon ? `Cupom: ${ctx.product.coupon}` : ""}
${ctx.product.dm_message ? `Mensagem DM sugerida: ${ctx.product.dm_message}` : ""}`);
  }

  if (ctx.campaign) {
    sections.push(`CAMPANHA:
Nome: ${ctx.campaign.name}
Objetivo: ${CAMPAIGN_OBJECTIVE_LABELS[ctx.campaign.objective] ?? ctx.campaign.objective}
${ctx.campaign.default_cta ? `CTA da campanha: ${ctx.campaign.default_cta}` : ""}
${ctx.campaign.comment_keyword ? `Palavra-chave: ${ctx.campaign.comment_keyword}` : ""}
${ctx.campaign.main_link ? `Link principal: ${ctx.campaign.main_link}` : ""}
${ctx.campaign.dm_message ? `DM: ${ctx.campaign.dm_message}` : ""}`);
  }

  if (ctx.contentObjective) {
    sections.push(`Objetivo do conteúdo: ${ctx.contentObjective}`);
  }

  sections.push(`Plataforma: ${platform === "tiktok" ? "TikTok" : "Instagram"}
Tipo: ${contentType}

REGRAS DE ADAPTAÇÃO POR PLATAFORMA:
- Instagram Reels: gancho forte, CTA de comentário/salvamento, hashtags, pode mencionar link na bio.
- TikTok: legenda curta, tom natural, hashtags de descoberta, CTA simples.
- Stories: texto MUITO curto, CTA direto (bio, DM, WhatsApp ou oferta), urgência leve.
- NUNCA use o mesmo texto para plataformas diferentes.`);

  return sections.join("\n\n");
}

export function resolveContentObjective(ctx: CampaignContext) {
  if (ctx.contentObjective) return ctx.contentObjective;
  if (ctx.campaign?.objective) {
    return CAMPAIGN_OBJECTIVE_LABELS[ctx.campaign.objective] ?? ctx.campaign.objective;
  }
  return null;
}

export function mergeCampaignFields(ctx: CampaignContext) {
  const product = ctx.product;
  const campaign = ctx.campaign;

  return {
    product_id: product?.id ?? campaign?.product_id ?? null,
    campaign_id: campaign?.id ?? null,
    content_objective: resolveContentObjective(ctx),
    cta:
      campaign?.default_cta ??
      product?.main_cta ??
      null,
    comment_keyword:
      campaign?.comment_keyword ??
      product?.comment_keyword ??
      null,
  };
}

export async function resolveSchedulingCampaignContext(
  supabase: import("@supabase/supabase-js").SupabaseClient,
  ownerId: string,
  body: {
    product_id?: string | null;
    campaign_id?: string | null;
    content_objective?: string | null;
  },
) {
  const { resolveCampaignContext } = await import("@/lib/campaigns/campaigns");
  const resolved = await resolveCampaignContext(supabase, ownerId, {
    productId: body.product_id,
    campaignId: body.campaign_id,
    contentObjective: body.content_objective,
  });

  return {
    product: resolved.product,
    campaign: resolved.campaign,
    contentObjective: body.content_objective ?? resolved.contentObjective ?? null,
  };
}
