import { isToday, parseISO } from "date-fns";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildClientReportedError,
  detectAllOperationalErrors,
  type DetectedOperationalError,
} from "@/lib/operations/error-detector";
import { buildAllAccountOperationsSummaries } from "@/lib/operations/account-ops";
import { getOwnerAccounts } from "@/lib/accounts";
import { getOwnerAccountRefs, getOwnerScheduledPosts } from "@/lib/posts";
import { getOwnerTikTokAccounts } from "@/lib/tiktok/accounts";
import { getBatchForOwner, listUploadBatchesForErrorScan } from "@/lib/upload/batches";
import type {
  OperationalError,
  OperationalErrorAction,
  OperationalErrorCategory,
  OperationalErrorSeverity,
  OperationalErrorStatus,
  OperationalErrorSummary,
} from "@/lib/types";

export interface OperationalErrorFilters {
  severity?: OperationalErrorSeverity | "all";
  status?: OperationalErrorStatus | "all" | "open_active";
  category?: OperationalErrorCategory | "all";
  accountId?: string;
  platform?: string;
  dateFrom?: string;
  dateTo?: string;
  q?: string;
}

export interface OperationalErrorsResult {
  errors: OperationalError[];
  summary: OperationalErrorSummary;
  syncedAt: string;
}

function rowToError(row: Record<string, unknown>): OperationalError {
  return {
    id: String(row.id),
    owner_id: String(row.owner_id),
    fingerprint: String(row.fingerprint),
    account_id: (row.account_id as string) ?? null,
    platform: (row.platform as OperationalError["platform"]) ?? null,
    content_type: (row.content_type as OperationalError["content_type"]) ?? null,
    upload_batch_id: (row.upload_batch_id as string) ?? null,
    upload_file_id: (row.upload_file_id as string) ?? null,
    scheduled_post_id: (row.scheduled_post_id as string) ?? null,
    error_type: String(row.error_type),
    category: row.category as OperationalError["category"],
    severity: row.severity as OperationalError["severity"],
    status: row.status as OperationalError["status"],
    title: String(row.title),
    message: String(row.message),
    technical_message: (row.technical_message as string) ?? null,
    probable_cause: (row.probable_cause as string) ?? null,
    recommended_action: (row.recommended_action as string) ?? null,
    metadata: (row.metadata as Record<string, unknown>) ?? {},
    available_actions: (row.available_actions as OperationalErrorAction[]) ?? [],
    first_seen_at: String(row.first_seen_at),
    last_seen_at: String(row.last_seen_at),
    resolved_at: (row.resolved_at as string) ?? null,
    retry_count: Number(row.retry_count ?? 0),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}

function detectedToOperationalError(ownerId: string, detected: DetectedOperationalError, index: number): OperationalError {
  const now = new Date().toISOString();
  return {
    id: `detected-${index}-${detected.fingerprint}`,
    owner_id: ownerId,
    fingerprint: detected.fingerprint,
    account_id: detected.accountId ?? null,
    platform: detected.platform ?? null,
    content_type: detected.contentType ?? null,
    upload_batch_id: detected.uploadBatchId ?? null,
    upload_file_id: detected.uploadFileId ?? null,
    scheduled_post_id: detected.scheduledPostId ?? null,
    error_type: detected.errorType,
    category: detected.category,
    severity: detected.severity,
    status: detected.status,
    title: detected.title,
    message: detected.message,
    technical_message: detected.technicalMessage ?? null,
    probable_cause: detected.probableCause,
    recommended_action: detected.recommendedAction,
    metadata: detected.metadata ?? {},
    available_actions: detected.availableActions,
    first_seen_at: now,
    last_seen_at: now,
    resolved_at: null,
    retry_count: 0,
    created_at: now,
    updated_at: now,
  };
}

async function detectWithoutPersist(
  supabase: SupabaseClient,
  ownerId: string,
): Promise<DetectedOperationalError[]> {
  const [refs, igAccounts, tiktokAccounts, posts, batchSummaries] = await Promise.all([
    getOwnerAccountRefs(supabase, ownerId),
    getOwnerAccounts(supabase, ownerId),
    getOwnerTikTokAccounts(supabase, ownerId),
    getOwnerScheduledPosts(supabase, ownerId, { hiddenFromReport: false, limit: 5000 }),
    listUploadBatchesForErrorScan(supabase, ownerId),
  ]);

  const batches = (
    await Promise.all(
      batchSummaries.map(async (summary) => getBatchForOwner(supabase, ownerId, summary.id)),
    )
  ).filter((batch): batch is NonNullable<typeof batch> => Boolean(batch));

  const accounts = await buildAllAccountOperationsSummaries({
    refs,
    igAccounts,
    tiktokAccounts,
    posts,
    ownerId,
  });

  const postIds = new Set(posts.map((p) => p.id));
  const { data: recentLogs } = postIds.size
    ? await supabase
        .from("publish_logs")
        .select("created_at")
        .in("post_id", [...postIds])
        .eq("level", "success")
        .order("created_at", { ascending: false })
        .limit(1)
    : { data: [] };

  return detectAllOperationalErrors({
    batches,
    posts,
    accounts,
    cronConfigured: Boolean(process.env.CRON_SECRET?.trim()),
    lastPublishAt: recentLogs?.[0]?.created_at ?? null,
  });
}

function isMissingTableError(error: { message?: string; code?: string }) {
  const msg = (error.message ?? "").toLowerCase();
  return (
    error.code === "42P01" ||
    msg.includes("operational_errors") ||
    msg.includes("does not exist") ||
    msg.includes("schema cache")
  );
}

function detectedToRow(ownerId: string, detected: DetectedOperationalError) {
  const now = new Date().toISOString();
  return {
    owner_id: ownerId,
    fingerprint: detected.fingerprint,
    account_id: detected.accountId ?? null,
    platform: detected.platform ?? null,
    content_type: detected.contentType ?? null,
    upload_batch_id: detected.uploadBatchId ?? null,
    upload_file_id: detected.uploadFileId ?? null,
    scheduled_post_id: detected.scheduledPostId ?? null,
    error_type: detected.errorType,
    category: detected.category,
    severity: detected.severity,
    status: detected.status,
    title: detected.title,
    message: detected.message,
    technical_message: detected.technicalMessage ?? null,
    probable_cause: detected.probableCause,
    recommended_action: detected.recommendedAction,
    metadata: detected.metadata ?? {},
    available_actions: detected.availableActions,
    last_seen_at: now,
    updated_at: now,
  };
}

function applyInMemoryFilters(errors: OperationalError[], filters: OperationalErrorFilters) {
  let result = errors;
  if (filters.severity && filters.severity !== "all") {
    result = result.filter((e) => e.severity === filters.severity);
  }
  if (filters.category && filters.category !== "all") {
    result = result.filter((e) => e.category === filters.category);
  }
  if (filters.accountId) {
    result = result.filter((e) => e.account_id === filters.accountId);
  }
  if (filters.platform && filters.platform !== "all") {
    result = result.filter((e) => e.platform === filters.platform);
  }
  if (filters.status === "resolved") {
    result = result.filter((e) => e.status === "resolved");
  } else if (filters.status === "ignored") {
    result = result.filter((e) => e.status === "ignored");
  } else if (filters.status === "needs_user_action") {
    result = result.filter((e) => e.status === "needs_user_action");
  } else if (filters.status === "open_active" || !filters.status) {
    result = result.filter((e) => e.status !== "resolved" && e.status !== "ignored");
  }
  if (filters.q?.trim()) {
    const q = filters.q.trim().toLowerCase();
    result = result.filter(
      (e) =>
        e.title.toLowerCase().includes(q) ||
        e.message.toLowerCase().includes(q) ||
        (e.technical_message?.toLowerCase().includes(q) ?? false),
    );
  }
  return result;
}

export async function upsertDetectedErrors(
  supabase: SupabaseClient,
  ownerId: string,
  detected: DetectedOperationalError[],
) {
  const fingerprints = new Set(detected.map((d) => d.fingerprint));

  const { data: openRows } = await supabase
    .from("operational_errors")
    .select("id, fingerprint, status, retry_count, metadata, first_seen_at")
    .eq("owner_id", ownerId)
    .not("status", "in", '("resolved","ignored")');

  for (const row of openRows ?? []) {
    if (!fingerprints.has(row.fingerprint as string)) {
      await supabase
        .from("operational_errors")
        .update({
          status: "resolved",
          resolved_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", row.id);
    }
  }

  for (const item of detected) {
    const existing = (openRows ?? []).find((r) => r.fingerprint === item.fingerprint);
    const payload = detectedToRow(ownerId, item);

    if (existing) {
      const prevMeta = (existing.metadata as Record<string, unknown>) ?? {};
      await supabase
        .from("operational_errors")
        .update({
          ...payload,
          first_seen_at: existing.first_seen_at,
          retry_count: Number(existing.retry_count ?? 0) + 1,
          metadata: { ...prevMeta, ...(item.metadata ?? {}), lastSyncAt: new Date().toISOString() },
        })
        .eq("id", existing.id);
    } else {
      await supabase.from("operational_errors").insert({
        ...payload,
        first_seen_at: new Date().toISOString(),
        retry_count: 0,
      });
    }
  }
}

export async function reportClientOperationalError(
  supabase: SupabaseClient,
  ownerId: string,
  params: Omit<Parameters<typeof buildClientReportedError>[0], never>,
) {
  const detected = buildClientReportedError(params);
  await upsertDetectedErrors(supabase, ownerId, [detected]);
  return detected;
}

export async function syncOperationalErrors(
  supabase: SupabaseClient,
  ownerId: string,
): Promise<DetectedOperationalError[]> {
  const detected = await detectWithoutPersist(supabase, ownerId);
  await upsertDetectedErrors(supabase, ownerId, detected);
  return detected;
}

function computeSummary(errors: OperationalError[]): OperationalErrorSummary {
  const openErrors = errors.filter((e) => e.status !== "resolved" && e.status !== "ignored");
  const accountIds = new Set(
    openErrors.filter((e) => e.category === "account" || e.severity === "critical").map((e) => e.account_id),
  );

  return {
    critical: openErrors.filter((e) => e.severity === "critical").length,
    high: openErrors.filter((e) => e.severity === "high").length,
    medium: openErrors.filter((e) => e.severity === "medium").length,
    low: openErrors.filter((e) => e.severity === "low").length,
    open: openErrors.filter((e) => e.status === "open").length,
    autoRetrying: openErrors.filter((e) => e.status === "auto_retrying").length,
    needsUserAction: openErrors.filter((e) => e.status === "needs_user_action").length,
    resolvedToday: errors.filter(
      (e) => e.status === "resolved" && e.resolved_at && isToday(parseISO(e.resolved_at)),
    ).length,
    stalledUploads: openErrors.filter((e) =>
      ["upload_stalled", "upload_no_progress", "upload_pending_stuck"].includes(e.error_type),
    ).length,
    failedPublications: openErrors.filter((e) => e.category === "publishing").length,
    accountsWithProblems: accountIds.size,
  };
}

export async function listOperationalErrors(
  supabase: SupabaseClient,
  ownerId: string,
  filters: OperationalErrorFilters = {},
): Promise<OperationalErrorsResult> {
  let tableReady = true;
  try {
    await syncOperationalErrors(supabase, ownerId);
  } catch (error) {
    if (
      error instanceof Error &&
      isMissingTableError({ message: error.message })
    ) {
      tableReady = false;
    } else {
      throw error;
    }
  }

  if (!tableReady) {
    const detected = await detectWithoutPersist(supabase, ownerId);
    let errors = detected.map((d, i) => detectedToOperationalError(ownerId, d, i));
    errors = applyInMemoryFilters(errors, filters);
    return {
      errors,
      summary: computeSummary(errors),
      syncedAt: new Date().toISOString(),
    };
  }

  let query = supabase
    .from("operational_errors")
    .select("*")
    .eq("owner_id", ownerId)
    .order("last_seen_at", { ascending: false })
    .limit(500);

  if (filters.severity && filters.severity !== "all") {
    query = query.eq("severity", filters.severity);
  }

  if (filters.category && filters.category !== "all") {
    query = query.eq("category", filters.category);
  }

  if (filters.accountId) {
    query = query.eq("account_id", filters.accountId);
  }

  if (filters.platform && filters.platform !== "all") {
    query = query.eq("platform", filters.platform);
  }

  if (filters.dateFrom) {
    query = query.gte("last_seen_at", filters.dateFrom);
  }

  if (filters.dateTo) {
    query = query.lte("last_seen_at", filters.dateTo);
  }

  if (filters.status === "resolved") {
    query = query.eq("status", "resolved");
  } else if (filters.status === "ignored") {
    query = query.eq("status", "ignored");
  } else if (filters.status === "needs_user_action") {
    query = query.eq("status", "needs_user_action");
  } else if (filters.status === "open_active") {
    query = query.not("status", "in", '("resolved","ignored")');
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  let errors = (data ?? []).map((row) => rowToError(row as Record<string, unknown>));

  if (filters.q?.trim()) {
    const q = filters.q.trim().toLowerCase();
    errors = errors.filter(
      (e) =>
        e.title.toLowerCase().includes(q) ||
        e.message.toLowerCase().includes(q) ||
        (e.technical_message?.toLowerCase().includes(q) ?? false),
    );
  }

  return {
    errors,
    summary: computeSummary(errors),
    syncedAt: new Date().toISOString(),
  };
}

export async function getOperationalErrorById(
  supabase: SupabaseClient,
  ownerId: string,
  errorId: string,
) {
  const { data, error } = await supabase
    .from("operational_errors")
    .select("*")
    .eq("owner_id", ownerId)
    .eq("id", errorId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) return null;
  return rowToError(data as Record<string, unknown>);
}

export async function resolveOperationalError(
  supabase: SupabaseClient,
  ownerId: string,
  errorId: string,
) {
  const { data, error } = await supabase
    .from("operational_errors")
    .update({
      status: "resolved",
      resolved_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("owner_id", ownerId)
    .eq("id", errorId)
    .select("*")
    .single();

  if (error) throw new Error(error.message);
  return rowToError(data as Record<string, unknown>);
}

export async function ignoreOperationalError(
  supabase: SupabaseClient,
  ownerId: string,
  errorId: string,
) {
  const { data, error } = await supabase
    .from("operational_errors")
    .update({
      status: "ignored",
      updated_at: new Date().toISOString(),
    })
    .eq("owner_id", ownerId)
    .eq("id", errorId)
    .select("*")
    .single();

  if (error) throw new Error(error.message);
  return rowToError(data as Record<string, unknown>);
}

export async function executeOperationalErrorAction(
  supabase: SupabaseClient,
  ownerId: string,
  error: OperationalError,
  actionType: OperationalErrorAction["type"],
) {
  switch (actionType) {
    case "retry_post": {
      if (!error.scheduled_post_id) throw new Error("Post não associado ao erro");
      const { data: post } = await supabase
        .from("scheduled_posts")
        .select("id, status, media_id")
        .eq("id", error.scheduled_post_id)
        .single();
      if (!post) throw new Error("Post não encontrado");
      if (post.media_id) throw new Error("Post já publicado");
      await supabase
        .from("scheduled_posts")
        .update({ status: "pending", error_message: null, next_retry_at: null })
        .eq("id", error.scheduled_post_id);
      return { ok: true, message: "Post recolocado na fila de publicação." };
    }
    case "resume_account": {
      if (!error.account_id || !error.platform) throw new Error("Conta não associada ao erro");
      const table = error.platform === "tiktok" ? "tiktok_accounts" : "instagram_accounts";
      await supabase.from(table).update({ publishing_paused: false }).eq("id", error.account_id);
      return { ok: true, message: "Publicações retomadas para a conta." };
    }
    case "reconcile_upload": {
      if (!error.upload_batch_id) throw new Error("Lote não associado ao erro");
      return {
        ok: true,
        message: "Use o endpoint de status do lote para reconciliar.",
        href: `/api/upload/batches/${error.upload_batch_id}/status`,
      };
    }
    default:
      return { ok: true, message: "Ação delegada ao cliente.", delegated: true };
  }
}

export const ERROR_STATUS_LABELS: Record<OperationalErrorStatus, string> = {
  open: "Aberto",
  investigating: "Investigando",
  auto_retrying: "Tentando corrigir",
  resolved: "Resolvido",
  ignored: "Ignorado",
  needs_user_action: "Precisa de ação",
};

export const ERROR_SEVERITY_LABELS: Record<OperationalErrorSeverity, string> = {
  critical: "Crítico",
  high: "Alto",
  medium: "Médio",
  low: "Baixo",
};

export const ERROR_CATEGORY_LABELS: Record<OperationalErrorCategory, string> = {
  upload: "Upload",
  scheduling: "Agendamento",
  publishing: "Publicação",
  account: "Conta",
  ai: "IA",
  system: "Sistema",
};

export function buildLogsHref(error: OperationalError) {
  const params = new URLSearchParams();
  if (error.scheduled_post_id) params.set("post", error.scheduled_post_id);
  if (error.upload_batch_id) params.set("batch", error.upload_batch_id);
  if (error.account_id) params.set("account", error.account_id);
  if (error.error_type) params.set("type", error.error_type);
  const qs = params.toString();
  return qs ? `/dashboard/logs?${qs}` : "/dashboard/logs";
}
