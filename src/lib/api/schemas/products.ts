import { z } from "zod";
import { optionalTrimmedString, optionalUrlSchema } from "@/lib/api/schemas/common";

export const productBodySchema = z.object({
  name: z.string().trim().min(1, "Nome do produto é obrigatório").max(200),
  niche: optionalTrimmedString(200),
  description: optionalTrimmedString(4000),
  price: z.coerce.number().nonnegative().max(1_000_000_000).optional().nullable(),
  checkout_url: optionalUrlSchema,
  sales_page_url: optionalUrlSchema,
  whatsapp_url: optionalUrlSchema,
  bio_url: optionalUrlSchema,
  main_cta: optionalTrimmedString(200),
  comment_keyword: optionalTrimmedString(100),
  dm_message: optionalTrimmedString(2000),
  coupon: optionalTrimmedString(100),
  status: z.enum(["active", "paused"]).optional(),
  notes: optionalTrimmedString(4000),
});

export const productPatchSchema = productBodySchema.partial();
