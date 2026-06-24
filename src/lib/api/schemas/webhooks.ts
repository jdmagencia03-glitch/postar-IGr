import { z } from "zod";

const webhookCommentValueSchema = z.object({
  id: z.string().min(1),
  text: z.string().optional(),
  from: z
    .object({
      id: z.string().optional(),
      username: z.string().optional(),
    })
    .optional(),
  media: z
    .object({
      id: z.string().optional(),
    })
    .optional(),
  timestamp: z.string().optional(),
});

const webhookChangeSchema = z.object({
  field: z.string().optional(),
  value: webhookCommentValueSchema.optional(),
});

const webhookEntrySchema = z.object({
  id: z.string().min(1),
  changes: z.array(webhookChangeSchema).optional(),
});

export const metaWebhookBodySchema = z.object({
  object: z.literal("instagram").optional(),
  entry: z.array(webhookEntrySchema).optional(),
});
