import { z } from "zod";
import { optionalTrimmedString, optionalUrlSchema, platformSchema, uuidSchema } from "@/lib/api/schemas/common";

const campaignObjectiveSchema = z.enum([
  "sell_product",
  "generate_leads",
  "bio_traffic",
  "whatsapp",
  "dm",
  "warm_audience",
  "grow_followers",
  "test_offer",
  "remarketing",
]);

export const campaignAccountSchema = z.object({
  account_id: uuidSchema,
  platform: platformSchema,
  content_types: z.array(z.string().trim().max(40)).max(20).optional(),
});

export const campaignBodySchema = z.object({
  product_id: uuidSchema.optional().nullable(),
  name: z.string().trim().min(1, "Nome da campanha é obrigatório").max(200),
  niche: optionalTrimmedString(200),
  objective: campaignObjectiveSchema.optional(),
  default_cta: optionalTrimmedString(200),
  comment_keyword: optionalTrimmedString(100),
  dm_message: optionalTrimmedString(2000),
  main_link: optionalUrlSchema,
  posts_per_day: z.coerce.number().int().min(0).max(500).optional(),
  stories_per_day: z.coerce.number().int().min(0).max(500).optional(),
  starts_at: z.string().max(64).optional().nullable(),
  ends_at: z.string().max(64).optional().nullable(),
  status: z.enum(["active", "paused", "finished"]).optional(),
  notes: optionalTrimmedString(4000),
  accounts: z.array(campaignAccountSchema).max(50).optional(),
});

export const campaignPatchSchema = campaignBodySchema.partial();
