import { z } from "zod";

export const metaOAuthExchangeSchema = z.object({
  code: z.string().trim().min(1, "Código OAuth obrigatório").max(4096),
  state: z.string().trim().min(1, "State OAuth obrigatório").max(512),
  next: z.string().trim().max(512).optional(),
});
