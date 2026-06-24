import { z } from "zod";

export const uuidSchema = z.string().uuid();

export const optionalUrlSchema = z
  .string()
  .trim()
  .url("URL inválida")
  .max(2048)
  .optional()
  .or(z.literal("").transform(() => undefined));

export const optionalTrimmedString = (max = 500) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .or(z.literal("").transform(() => undefined));

export const platformSchema = z.enum(["instagram", "tiktok"]);

export const listStatusSchema = z.enum(["all", "active", "paused"]).catch("all");

export const campaignListStatusSchema = z
  .enum(["all", "active", "paused", "finished"])
  .catch("all");
