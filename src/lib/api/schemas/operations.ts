import { z } from "zod";
import { optionalTrimmedString, platformSchema, uuidSchema } from "@/lib/api/schemas/common";

const operationalErrorSeveritySchema = z.enum(["critical", "high", "medium", "low"]);
const operationalErrorStatusSchema = z.enum([
  "open",
  "investigating",
  "auto_retrying",
  "resolved",
  "ignored",
  "needs_user_action",
]);
const operationalErrorCategorySchema = z.enum([
  "upload",
  "scheduling",
  "publishing",
  "account",
  "ai",
  "system",
]);

export const operationalErrorFiltersSchema = z.object({
  severity: z.union([operationalErrorSeveritySchema, z.literal("all")]).catch("all"),
  status: z
    .union([operationalErrorStatusSchema, z.literal("all"), z.literal("open_active")])
    .catch("open_active"),
  category: z.union([operationalErrorCategorySchema, z.literal("all")]).catch("all"),
  accountId: uuidSchema.optional(),
  platform: platformSchema.optional(),
  dateFrom: z.string().max(40).optional(),
  dateTo: z.string().max(40).optional(),
  q: optionalTrimmedString(200),
});

export const operationalErrorReportSchema = z.object({
  errorType: z.string().trim().min(1).max(120).optional(),
  title: z.string().trim().min(1).max(200),
  message: z.string().trim().max(8000).optional(),
  technicalMessage: optionalTrimmedString(8000),
  probableCause: optionalTrimmedString(2000),
  recommendedAction: optionalTrimmedString(2000),
  severity: operationalErrorSeveritySchema.optional(),
  status: operationalErrorStatusSchema.optional(),
  category: operationalErrorCategorySchema.optional(),
  accountId: uuidSchema.optional(),
  platform: platformSchema.optional(),
  uploadBatchId: uuidSchema.optional(),
  uploadFileId: uuidSchema.optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const operationalErrorActionSchema = z.object({
  action: z.enum([
    "retry_upload",
    "reconcile_upload",
    "retry_post",
    "reschedule_post",
    "validate_account",
    "reconnect_account",
    "regenerate_caption",
    "open_batch",
    "open_post",
    "open_diagnostics",
    "open_calendar",
    "open_logs",
    "cancel_batch",
    "resume_account",
    "reupload_media",
    "cancel_post",
    "audit_queue",
    "mark_as_published",
    "cancel_as_duplicate",
    "manual_review",
    "pause_account",
    "cancel_as_rate_limited_abandoned",
  ]),
});
