import { differenceInMinutes, isPast, parseISO } from "date-fns";
import { CONTENT_TYPE_LABELS } from "@/lib/content-types";
import type { AccountOperationsSummary } from "@/lib/operations/account-ops";
import { buildPublicationAudit } from "@/lib/operations/publication-audit";
import { getPostAccountUsername } from "@/lib/posts";
import { UPLOAD_STALL_TIMEOUT_MS } from "@/lib/upload/storage-config";
import type {
  ContentType,
  OperationalErrorAction,
  OperationalErrorCategory,
  OperationalErrorSeverity,
  OperationalErrorStatus,
  ScheduledPost,
  SocialPlatform,
  UploadBatch,
  UploadBatchFile,
} from "@/lib/types";

export interface DetectedOperationalError {
  fingerprint: string;
  errorType: string;
  category: OperationalErrorCategory;
  severity: OperationalErrorSeverity;
  status: OperationalErrorStatus;
  title: string;
  message: string;
  technicalMessage?: string;
  probableCause: string;
  recommendedAction: string;
  accountId?: string;
  platform?: SocialPlatform;
  contentType?: ContentType;
  uploadBatchId?: string;
  uploadFileId?: string;
  scheduledPostId?: string;
  metadata?: Record<string, unknown>;
  availableActions: OperationalErrorAction[];
}

export function buildErrorFingerprint(parts: Array<string | null | undefined>) {
  return parts.filter(Boolean).join("::");
}

function action(
  type: OperationalErrorAction["type"],
  label: string,
  href?: string,
  method?: "GET" | "POST",
): OperationalErrorAction {
  return { type, label, href, method };
}

function batchAccountUsername(batch: UploadBatch) {
  if (batch.platform === "tiktok") {
    return batch.tiktok_accounts?.username ?? batch.tiktok_accounts?.display_name ?? "tiktok";
  }
  return batch.instagram_accounts?.ig_username ?? "instagram";
}

function batchAccountId(batch: UploadBatch) {
  return (batch.platform === "tiktok" ? batch.tiktok_account_id : batch.account_id) ?? undefined;
}

function uploadFileProgress(file: UploadBatchFile) {
  const total = Number(file.file_size) || 0;
  if (file.status === "completed") return 100;
  return total > 0 ? Math.round((Number(file.bytes_uploaded ?? 0) / total) * 100) : 0;
}

function isUploadStalled(file: UploadBatchFile, now = Date.now()) {
  if (file.status !== "uploading" && file.status !== "retrying") return false;
  return now - new Date(file.updated_at).getTime() >= UPLOAD_STALL_TIMEOUT_MS;
}

function classifyPublishError(post: ScheduledPost): {
  severity: OperationalErrorSeverity;
  status: OperationalErrorStatus;
  title: string;
  probableCause: string;
  recommendedAction: string;
  actions: OperationalErrorAction[];
} {
  const msg = (post.error_message ?? "").toLowerCase();
  const accountId = (post.platform === "tiktok" ? post.tiktok_account_id : post.account_id) ?? "";
  const platform = post.platform ?? "instagram";
  const contentType = (post.content_type ?? "reel") as ContentType;

  if (msg.includes("token") || msg.includes("expir") || msg.includes("oauth")) {
    return {
      severity: "critical",
      status: "needs_user_action",
      title: "Token expirado na publicação",
      probableCause: "A conta perdeu autorização com a plataforma.",
      recommendedAction: "Reconecte a conta e tente publicar novamente.",
      actions: [
        action(
          "reconnect_account",
          "Reconectar conta",
          platform === "tiktok"
            ? `/api/tiktok/connect?next=/dashboard/errors`
            : `/api/auth/meta?next=/dashboard/errors`,
        ),
        action("open_diagnostics", "Diagnóstico", `/dashboard/accounts/${accountId}/diagnostics?platform=${platform}`),
        action("retry_post", "Tentar novamente", undefined, "POST"),
      ],
    };
  }

  if (msg.includes("permission") || msg.includes("permiss")) {
    return {
      severity: "high",
      status: "needs_user_action",
      title: "Permissão insuficiente",
      probableCause: "A conta não tem escopo necessário para este tipo de conteúdo.",
      recommendedAction: "Valide permissões e reconecte se necessário.",
      actions: [
        action(
          "validate_account",
          "Validar permissões",
          `/api/operations/accounts/${accountId}/validate?platform=${platform}`,
        ),
        action("open_diagnostics", "Diagnóstico", `/dashboard/accounts/${accountId}/diagnostics?platform=${platform}`),
      ],
    };
  }

  if (contentType === "story") {
    return {
      severity: "high",
      status: post.status === "retrying" ? "auto_retrying" : "open",
      title: "Falha ao publicar Story",
      probableCause: "Stories exigem permissões Meta específicas ou mídia inválida.",
      recommendedAction: "Verifique diagnóstico da conta e tente novamente.",
      actions: [
        action("open_post", "Ver publicação", `/dashboard/posts/${post.id}`),
        action("open_diagnostics", "Diagnóstico", `/dashboard/accounts/${accountId}/diagnostics?platform=${platform}`),
        action("retry_post", "Tentar novamente", undefined, "POST"),
      ],
    };
  }

  if (platform === "tiktok") {
    return {
      severity: post.status === "failed_persistent" ? "high" : "medium",
      status: post.status === "retrying" ? "auto_retrying" : "open",
      title: "Falha na publicação TikTok",
      probableCause: "API TikTok rejeitou o vídeo ou houve erro de conexão.",
      recommendedAction: "Veja detalhes do post e tente novamente.",
      actions: [
        action("open_post", "Ver publicação", `/dashboard/posts/${post.id}`),
        action("open_logs", "Ver logs", `/dashboard/logs?post=${post.id}`),
        action("retry_post", "Tentar novamente", undefined, "POST"),
      ],
    };
  }

  if (post.status === "processing") {
    return {
      severity: "high",
      status: "investigating",
      title: "Publicação presa em andamento",
      probableCause: "O cron pode não ter finalizado ou houve falha crítica após publicar.",
      recommendedAction: "Aguarde alguns minutos ou force retry manual.",
      actions: [
        action("open_post", "Ver publicação", `/dashboard/posts/${post.id}`),
        action("open_logs", "Ver logs", `/dashboard/logs?post=${post.id}`),
        action("retry_post", "Tentar novamente", undefined, "POST"),
      ],
    };
  }

  if (post.status === "failed_persistent") {
    return {
      severity: "high",
      status: "needs_user_action",
      title: "Publicação falhou definitivamente",
      probableCause: "Todas as tentativas automáticas foram esgotadas.",
      recommendedAction: "Corrija a causa e reagende ou tente manualmente.",
      actions: [
        action("open_post", "Ver publicação", `/dashboard/posts/${post.id}`),
        action("reschedule_post", "Reagendar", `/dashboard/posts/${post.id}`),
        action("retry_post", "Tentar novamente", undefined, "POST"),
      ],
    };
  }

  return {
    severity: "medium",
    status: post.status === "retrying" ? "auto_retrying" : "open",
    title: "Falha na publicação Instagram",
    probableCause: "Erro na API Meta ou mídia indisponível no momento da publicação.",
    recommendedAction: "Veja logs e tente novamente.",
    actions: [
      action("open_post", "Ver publicação", `/dashboard/posts/${post.id}`),
      action("open_logs", "Ver logs", `/dashboard/logs?post=${post.id}`),
      action("retry_post", "Tentar novamente", undefined, "POST"),
    ],
  };
}

export function detectUploadErrors(batches: UploadBatch[], now = new Date()): DetectedOperationalError[] {
  const errors: DetectedOperationalError[] = [];
  const nowMs = now.getTime();

  for (const batch of batches) {
    const files = (batch.upload_files ?? []).filter((f) => !f.removed);
    const accountId = batchAccountId(batch);
    const username = batchAccountUsername(batch);
    const platform = batch.platform ?? "instagram";
    const stalledFiles = files.filter((f) => isUploadStalled(f, nowMs));
    const retryingLong = files.filter(
      (f) =>
        f.status === "retrying" &&
        nowMs - new Date(f.updated_at).getTime() >= UPLOAD_STALL_TIMEOUT_MS * 2,
    );
    const failedFiles = files.filter((f) => f.status === "failed");
    const pendingStuck = files.filter(
      (f) => f.status === "pending" && batch.status === "uploading" && files.some((x) => x.status === "uploading"),
    );

    if (stalledFiles.length > 0) {
      const isMass = stalledFiles.length >= 3;
      errors.push({
        fingerprint: buildErrorFingerprint(["upload", "stalled_batch", batch.id]),
        errorType: "upload_stalled",
        category: "upload",
        severity: isMass ? "critical" : "high",
        status: "needs_user_action",
        title: isMass
          ? `${stalledFiles.length} uploads travados no lote #${batch.batch_number}`
          : `Upload travado no lote #${batch.batch_number}`,
        message: `@${username}: ${stalledFiles.length} arquivo(s) sem progresso há mais de ${Math.round(UPLOAD_STALL_TIMEOUT_MS / 60_000)} min.`,
        technicalMessage: stalledFiles
          .slice(0, 5)
          .map((f) => `${f.filename} (${f.status})`)
          .join("; "),
        probableCause: "Conexão instável, evento perdido ou upload engine travado.",
        recommendedAction: "Tente reconciliar status ou reenviar arquivos com erro.",
        accountId,
        platform,
        uploadBatchId: batch.id,
        metadata: {
          batchNumber: batch.batch_number,
          stalledCount: stalledFiles.length,
          filenames: stalledFiles.slice(0, 10).map((f) => f.filename),
        },
        availableActions: [
          action("reconcile_upload", "Reconciliar status", `/api/upload/batches/${batch.id}/status`),
          action("open_batch", "Abrir lote", `/dashboard/uploads/${batch.id}`),
          action("retry_upload", "Tentar novamente", `/dashboard/uploads/${batch.id}`),
        ],
      });
    }

    for (const file of stalledFiles.slice(0, isMassStall(stalledFiles) ? 3 : 5)) {
      errors.push({
        fingerprint: buildErrorFingerprint(["upload", "stalled_file", file.id]),
        errorType: "upload_no_progress",
        category: "upload",
        severity: "high",
        status: "needs_user_action",
        title: "Upload sem progresso detectado",
        message: `${file.filename} em @${username} parou em ${uploadFileProgress(file)}%.`,
        probableCause: "Conexão instável, evento perdido ou upload engine travado.",
        recommendedAction: "Tente reconciliar status ou reenviar o arquivo.",
        accountId,
        platform,
        uploadBatchId: batch.id,
        uploadFileId: file.id,
        metadata: {
          filename: file.filename,
          progress: uploadFileProgress(file),
          batchNumber: batch.batch_number,
        },
        availableActions: [
          action("reconcile_upload", "Reconciliar status", `/api/upload/batches/${batch.id}/status`),
          action("open_batch", "Abrir lote", `/dashboard/uploads/${batch.id}`),
        ],
      });
    }

    for (const file of retryingLong) {
      const msg = (file.error_message ?? "").toLowerCase();
      const isConnection = msg.includes("conex") || msg.includes("network") || msg.includes("timeout");
      errors.push({
        fingerprint: buildErrorFingerprint(["upload", "retrying_long", file.id]),
        errorType: isConnection ? "upload_connection_failure" : "upload_retrying_long",
        category: "upload",
        severity: "medium",
        status: "auto_retrying",
        title: isConnection ? "Falha de conexão no upload" : "Upload em retry há tempo demais",
        message: `${file.filename}: ${file.error_message ?? "aguardando nova tentativa"}.`,
        probableCause: isConnection
          ? "Conexão instável entre navegador e storage."
          : "O sistema está tentando reenviar automaticamente.",
        recommendedAction: isConnection
          ? "Aguarde ou abra o lote para forçar nova tentativa."
          : "Aguarde o retry automático ou abra o lote.",
        accountId,
        platform,
        uploadBatchId: batch.id,
        uploadFileId: file.id,
        metadata: { retryCount: file.retry_count ?? 0, filename: file.filename },
        availableActions: [
          action("open_batch", "Abrir lote", `/dashboard/uploads/${batch.id}`),
          action("reconcile_upload", "Recarregar status", `/api/upload/batches/${batch.id}/status`),
        ],
      });
    }

    for (const file of failedFiles.filter((f) => (f.retry_count ?? 0) >= 3)) {
      errors.push({
        fingerprint: buildErrorFingerprint(["upload", "failed_definitive", file.id]),
        errorType: "upload_failed_persistent",
        category: "upload",
        severity: "high",
        status: "needs_user_action",
        title: `Upload falhou várias vezes: ${file.filename}`,
        message: file.error_message ?? "Arquivo marcado como falha após várias tentativas.",
        probableCause: "Arquivo inválido, permissão ou limite de storage.",
        recommendedAction: "Remova o arquivo com erro ou selecione novamente para reenviar.",
        accountId,
        platform,
        uploadBatchId: batch.id,
        uploadFileId: file.id,
        metadata: { retryCount: file.retry_count ?? 0 },
        availableActions: [
          action("open_batch", "Abrir lote", `/dashboard/uploads/${batch.id}`),
          action("retry_upload", "Tentar arquivos com erro", `/dashboard/uploads/${batch.id}`),
        ],
      });
    }

    if (batch.status === "uploading" && batch.paused) {
      errors.push({
        fingerprint: buildErrorFingerprint(["upload", "paused_unexpected", batch.id]),
        errorType: "upload_paused",
        category: "upload",
        severity: "medium",
        status: "open",
        title: `Lote #${batch.batch_number} pausado`,
        message: `@${username}: upload pausado sem conclusão.`,
        probableCause: "Pausa manual ou recuperação automática após travamento.",
        recommendedAction: "Abra o lote e retome o envio.",
        accountId,
        platform,
        uploadBatchId: batch.id,
        availableActions: [action("open_batch", "Abrir lote", `/dashboard/uploads/${batch.id}`)],
      });
    }

    const completed = files.filter((f) => f.status === "completed").length;
    const failed = failedFiles.length;
    if (batch.status === "ready" && failed > 0 && completed > 0) {
      errors.push({
        fingerprint: buildErrorFingerprint(["upload", "partial_batch", batch.id]),
        errorType: "upload_partial_batch",
        category: "upload",
        severity: "medium",
        status: "needs_user_action",
        title: `Lote #${batch.batch_number} parcialmente concluído`,
        message: `${completed} enviados, ${failed} com falha em @${username}.`,
        probableCause: "Alguns arquivos falharam durante o upload em lote.",
        recommendedAction: "Reenvie apenas os arquivos com erro ou agende os concluídos.",
        accountId,
        platform,
        uploadBatchId: batch.id,
        metadata: { completed, failed, total: files.length },
        availableActions: [
          action("open_batch", "Abrir lote", `/dashboard/uploads/${batch.id}`),
          action("retry_upload", "Tentar arquivos com erro", `/dashboard/uploads/${batch.id}`),
        ],
      });
    }

    if (pendingStuck.length >= 5 && batch.status === "uploading") {
      errors.push({
        fingerprint: buildErrorFingerprint(["upload", "pending_stuck", batch.id]),
        errorType: "upload_pending_stuck",
        category: "upload",
        severity: "high",
        status: "open",
        title: `${pendingStuck.length} arquivos presos em pending`,
        message: `Lote #${batch.batch_number} (@${username}) não avança na fila.`,
        probableCause: "Engine de upload parado ou sessão sem arquivos locais.",
        recommendedAction: "Abra o lote e selecione os arquivos novamente se necessário.",
        accountId,
        platform,
        uploadBatchId: batch.id,
        availableActions: [action("open_batch", "Abrir lote", `/dashboard/uploads/${batch.id}`)],
      });
    }
  }

  return errors;
}

function isMassStall(files: UploadBatchFile[]) {
  return files.length >= 3;
}

export function detectPublishingErrors(posts: ScheduledPost[]): DetectedOperationalError[] {
  const errors: DetectedOperationalError[] = [];
  const now = new Date();

  const problemPosts = posts.filter(
    (p) =>
      p.status === "failed" ||
      p.status === "failed_persistent" ||
      p.status === "retrying" ||
      p.status === "processing",
  );

  for (const post of problemPosts) {
    const accountId = (post.platform === "tiktok" ? post.tiktok_account_id : post.account_id) ?? "";
    const platform = post.platform ?? "instagram";
    const contentType = (post.content_type ?? "reel") as ContentType;
    const classified = classifyPublishError(post);

    errors.push({
      fingerprint: buildErrorFingerprint(["publish", post.id, post.status]),
      errorType: `publish_${post.status}`,
      category: "publishing",
      severity: classified.severity,
      status: classified.status,
      title: classified.title,
      message: post.error_message
        ? `${getPostAccountUsername(post)}: ${post.error_message}`
        : `${getPostAccountUsername(post)} — ${CONTENT_TYPE_LABELS[contentType]}`,
      technicalMessage: post.error_message ?? undefined,
      probableCause: classified.probableCause,
      recommendedAction: classified.recommendedAction,
      accountId,
      platform,
      contentType,
      scheduledPostId: post.id,
      metadata: {
        scheduledAt: post.scheduled_at,
        retryCount: post.retry_count ?? 0,
        nextRetryAt: post.next_retry_at,
        contentTypeLabel: CONTENT_TYPE_LABELS[contentType],
      },
      availableActions: classified.actions,
    });
  }

  const overduePending = posts.filter(
    (p) =>
      (p.status === "pending" || p.status === "retrying") &&
      isPast(parseISO(p.scheduled_at)) &&
      differenceInMinutes(now, parseISO(p.scheduled_at)) >= 15,
  );

  for (const post of overduePending) {
    const accountId = (post.platform === "tiktok" ? post.tiktok_account_id : post.account_id) ?? "";
    errors.push({
      fingerprint: buildErrorFingerprint(["publish", "overdue", post.id]),
      errorType: "publish_overdue",
      category: "publishing",
      severity: "high",
      status: "open",
      title: "Post não publicado no horário",
      message: `${getPostAccountUsername(post)}: agendado para ${post.scheduled_at} e ainda pendente.`,
      probableCause: "Cron atrasado, conta pausada ou fila bloqueada.",
      recommendedAction: "Verifique logs e status da conta.",
      accountId,
      platform: post.platform ?? "instagram",
      contentType: (post.content_type ?? "reel") as ContentType,
      scheduledPostId: post.id,
      availableActions: [
        action("open_post", "Ver publicação", `/dashboard/posts/${post.id}`),
        action("open_logs", "Ver logs", `/dashboard/logs?post=${post.id}`),
        action("retry_post", "Tentar publicar", undefined, "POST"),
      ],
    });
  }

  return errors;
}

export function detectSchedulingErrors(posts: ScheduledPost[]): DetectedOperationalError[] {
  const errors: DetectedOperationalError[] = [];
  const audit = buildPublicationAudit(posts, { auditPeriod: "last_7_days" });

  for (const row of audit.rows.filter((r) => r.isPastDue && r.status === "pending")) {
    errors.push({
      fingerprint: buildErrorFingerprint(["schedule", "past_due", row.postId]),
      errorType: "schedule_past_due",
      category: "scheduling",
      severity: "medium",
      status: "open",
      title: "Post com horário no passado",
      message: `@${row.accountUsername}: agendado para ${row.scheduledAt}.`,
      probableCause: "Horário já passou e o post ainda não foi publicado.",
      recommendedAction: "Reagende para o próximo horário livre.",
      accountId: row.accountId,
      platform: row.platform,
      scheduledPostId: row.postId,
      availableActions: [
        action("reschedule_post", "Reagendar", `/dashboard/posts/${row.postId}`),
        action("open_calendar", "Abrir calendário", "/dashboard/calendar"),
      ],
    });
  }

  for (const row of audit.rows.filter((r) => r.isDuplicateSuspect)) {
    errors.push({
      fingerprint: buildErrorFingerprint(["schedule", "duplicate", row.postId]),
      errorType: "schedule_duplicate",
      category: "scheduling",
      severity: "medium",
      status: "open",
      title: "Possível vídeo duplicado no calendário",
      message: `${row.videoLabel} em @${row.accountUsername}.`,
      probableCause: "Mesmo vídeo agendado mais de uma vez.",
      recommendedAction: "Revise o calendário e remova duplicatas.",
      accountId: row.accountId,
      platform: row.platform,
      scheduledPostId: row.postId,
      metadata: { flags: row.duplicateFlags },
      availableActions: [
        action("open_calendar", "Abrir calendário", "/dashboard/calendar"),
        action("open_post", "Ver publicação", `/dashboard/posts/${row.postId}`),
      ],
    });
  }

  if (audit.summary.offScheduleCount > 0) {
    errors.push({
      fingerprint: buildErrorFingerprint(["schedule", "off_schedule_summary"]),
      errorType: "schedule_off_schedule",
      category: "scheduling",
      severity: "low",
      status: "open",
      title: `${audit.summary.offScheduleCount} publicação(ões) fora do horário`,
      message: audit.summary.statusMessage,
      probableCause: "Publicações saíram com atraso em relação ao agendamento.",
      recommendedAction: "Revise o cron e a fila de publicação.",
      availableActions: [
        action("open_calendar", "Abrir calendário", "/dashboard/calendar"),
        action("open_logs", "Ver logs", "/dashboard/logs"),
      ],
    });
  }

  return errors;
}

export function detectAccountErrors(accounts: AccountOperationsSummary[]): DetectedOperationalError[] {
  const errors: DetectedOperationalError[] = [];

  for (const account of accounts) {
    const label = account.username ? `@${account.username}` : "conta";

    if (account.tokenStatus === "expired") {
      errors.push({
        fingerprint: buildErrorFingerprint(["account", "token_expired", account.id]),
        errorType: "account_token_expired",
        category: "account",
        severity: "critical",
        status: "needs_user_action",
        title: "Conta desconectada",
        message: `${label} precisa ser reconectada.`,
        probableCause: "Token OAuth expirado ou revogado.",
        recommendedAction: "Reconecte a conta para retomar publicações.",
        accountId: account.id,
        platform: account.platform,
        availableActions: [
          action(
            "reconnect_account",
            "Reconectar",
            account.platform === "tiktok"
              ? `/api/tiktok/connect?next=/dashboard/errors`
              : `/api/auth/meta?next=/dashboard/errors`,
          ),
          action("open_diagnostics", "Diagnóstico", `/dashboard/accounts/${account.id}/diagnostics?platform=${account.platform}`),
        ],
      });
    }

    if (account.publishingPaused) {
      errors.push({
        fingerprint: buildErrorFingerprint(["account", "paused", account.id]),
        errorType: "account_paused",
        category: "account",
        severity: "medium",
        status: "open",
        title: "Publicações pausadas",
        message: `${label} está com publicação automática pausada.`,
        probableCause: "Pausa manual ou automática por segurança.",
        recommendedAction: "Retome publicações no diagnóstico da conta.",
        accountId: account.id,
        platform: account.platform,
        availableActions: [
          action("resume_account", "Retomar publicações", undefined, "POST"),
          action("open_diagnostics", "Diagnóstico", `/dashboard/accounts/${account.id}/diagnostics?platform=${account.platform}`),
        ],
      });
    }

    if (!account.playbookConfigured) {
      errors.push({
        fingerprint: buildErrorFingerprint(["account", "no_playbook", account.id]),
        errorType: "account_no_playbook",
        category: "account",
        severity: "low",
        status: "open",
        title: "Conta sem playbook",
        message: `${label} não tem assistente de conteúdo configurado.`,
        probableCause: "Playbook de IA não foi criado para esta conta.",
        recommendedAction: "Configure o assistente para gerar legendas automaticamente.",
        accountId: account.id,
        platform: account.platform,
        availableActions: [
          action("regenerate_caption", "Abrir playbook", `/dashboard/ai?account=${account.id}`),
        ],
      });
    }

    if (account.storiesBlocked > 0) {
      errors.push({
        fingerprint: buildErrorFingerprint(["account", "story_blocked", account.id]),
        errorType: "account_story_permission",
        category: "account",
        severity: "high",
        status: "needs_user_action",
        title: "Stories bloqueados por permissão",
        message: `${account.storiesBlocked} story(s) aguardando permissão Meta em ${label}.`,
        probableCause: "Conta Meta sem permissão de publicação de Stories.",
        recommendedAction: "Valide permissões e reconecte via Facebook se necessário.",
        accountId: account.id,
        platform: account.platform,
        availableActions: [
          action("validate_account", "Validar permissões", `/api/operations/accounts/${account.id}/validate?platform=${account.platform}`),
          action("open_diagnostics", "Diagnóstico", `/dashboard/accounts/${account.id}/diagnostics?platform=${account.platform}`),
        ],
      });
    }

    if (account.health === "error" && account.tokenStatus !== "expired" && account.lastError) {
      errors.push({
        fingerprint: buildErrorFingerprint(["account", "health_error", account.id]),
        errorType: "account_validation_failed",
        category: "account",
        severity: "critical",
        status: "needs_user_action",
        title: "Conta com problema operacional",
        message: `${label}: ${account.lastError}`,
        probableCause: "Falha na validação de permissões ou API da plataforma.",
        recommendedAction: "Execute diagnóstico completo da conta.",
        accountId: account.id,
        platform: account.platform,
        availableActions: [
          action("validate_account", "Validar permissões", `/api/operations/accounts/${account.id}/validate?platform=${account.platform}`),
          action("open_diagnostics", "Diagnóstico", `/dashboard/accounts/${account.id}/diagnostics?platform=${account.platform}`),
        ],
      });
    }
  }

  return errors;
}

export function detectSystemErrors(params: {
  cronConfigured: boolean;
  lastPublishAt: string | null;
  hasPendingPosts: boolean;
  stalledUploadCount: number;
  failedPublicationCount: number;
}): DetectedOperationalError[] {
  const errors: DetectedOperationalError[] = [];

  if (!params.cronConfigured) {
    errors.push({
      fingerprint: buildErrorFingerprint(["system", "cron_missing"]),
      errorType: "system_cron_missing",
      category: "system",
      severity: "critical",
      status: "needs_user_action",
      title: "Cron de publicação não configurado",
      message: "As publicações automáticas podem não sair.",
      probableCause: "CRON_SECRET ou agendador externo não configurado.",
      recommendedAction: "Configure o cron de publicação no Vercel/cron-job.org.",
      availableActions: [action("open_logs", "Ver logs", "/dashboard/logs")],
    });
  }

  if (
    params.lastPublishAt &&
    params.hasPendingPosts &&
    Date.now() - new Date(params.lastPublishAt).getTime() > 48 * 60 * 60 * 1000
  ) {
    errors.push({
      fingerprint: buildErrorFingerprint(["system", "cron_stale"]),
      errorType: "system_cron_stale",
      category: "system",
      severity: "high",
      status: "open",
      title: "Publicador sem atividade recente",
      message: "Há posts na fila, mas nenhuma publicação com sucesso nas últimas 48h.",
      probableCause: "Cron parado, token inválido ou fila bloqueada.",
      recommendedAction: "Verifique logs e saúde do publicador.",
      availableActions: [action("open_logs", "Ver logs", "/dashboard/logs")],
    });
  }

  if (params.stalledUploadCount >= 5) {
    errors.push({
      fingerprint: buildErrorFingerprint(["system", "mass_upload_stall"]),
      errorType: "system_mass_upload_stall",
      category: "system",
      severity: "critical",
      status: "needs_user_action",
      title: "Upload travado em massa",
      message: `${params.stalledUploadCount} arquivos sem progresso.`,
      probableCause: "Problema sistêmico no upload ou conexão.",
      recommendedAction: "Abra uploads e reconcilie os lotes afetados.",
      availableActions: [action("open_batch", "Ver uploads", "/dashboard/uploads")],
    });
  }

  if (params.failedPublicationCount >= 5) {
    errors.push({
      fingerprint: buildErrorFingerprint(["system", "mass_publish_failure"]),
      errorType: "system_mass_publish_failure",
      category: "system",
      severity: "critical",
      status: "open",
      title: "Várias publicações falhando",
      message: `${params.failedPublicationCount} publicações com erro ativo.`,
      probableCause: "Token, permissão ou problema na API das plataformas.",
      recommendedAction: "Revise contas desconectadas e logs de publicação.",
      availableActions: [action("open_logs", "Ver logs", "/dashboard/logs")],
    });
  }

  return errors;
}

export function detectAllOperationalErrors(params: {
  batches: UploadBatch[];
  posts: ScheduledPost[];
  accounts: AccountOperationsSummary[];
  cronConfigured: boolean;
  lastPublishAt: string | null;
}): DetectedOperationalError[] {
  const uploadErrors = detectUploadErrors(params.batches);
  const publishingErrors = detectPublishingErrors(params.posts);
  const schedulingErrors = detectSchedulingErrors(params.posts);
  const accountErrors = detectAccountErrors(params.accounts);
  const stalledUploadCount = uploadErrors.filter((e) => e.errorType === "upload_stalled").length;
  const failedPublicationCount = publishingErrors.filter((e) =>
    ["publish_failed", "publish_failed_persistent"].includes(e.errorType),
  ).length;

  const systemErrors = detectSystemErrors({
    cronConfigured: params.cronConfigured,
    lastPublishAt: params.lastPublishAt,
    hasPendingPosts: params.posts.some((p) => p.status === "pending"),
    stalledUploadCount,
    failedPublicationCount,
  });

  const byFingerprint = new Map<string, DetectedOperationalError>();
  for (const error of [
    ...uploadErrors,
    ...publishingErrors,
    ...schedulingErrors,
    ...accountErrors,
    ...systemErrors,
  ]) {
    byFingerprint.set(error.fingerprint, error);
  }

  return [...byFingerprint.values()];
}

/** Erro reportado pelo cliente (ex.: regressão de progresso, UI travada). */
export function buildClientReportedError(params: {
  errorType: string;
  title: string;
  message: string;
  technicalMessage?: string;
  probableCause: string;
  recommendedAction: string;
  severity?: OperationalErrorSeverity;
  status?: OperationalErrorStatus;
  category?: OperationalErrorCategory;
  accountId?: string;
  platform?: SocialPlatform;
  uploadBatchId?: string;
  uploadFileId?: string;
  metadata?: Record<string, unknown>;
}): DetectedOperationalError {
  const fingerprint = buildErrorFingerprint([
    "client",
    params.errorType,
    params.uploadBatchId,
    params.uploadFileId,
    params.accountId,
  ]);

  const actions: OperationalErrorAction[] = [];
  if (params.uploadBatchId) {
    actions.push(action("open_batch", "Abrir lote", `/dashboard/uploads/${params.uploadBatchId}`));
    actions.push(
      action("reconcile_upload", "Reconciliar status", `/api/upload/batches/${params.uploadBatchId}/status`),
    );
  }

  return {
    fingerprint,
    errorType: params.errorType,
    category: params.category ?? "upload",
    severity: params.severity ?? "medium",
    status: params.status ?? "open",
    title: params.title,
    message: params.message,
    technicalMessage: params.technicalMessage,
    probableCause: params.probableCause,
    recommendedAction: params.recommendedAction,
    accountId: params.accountId,
    platform: params.platform,
    uploadBatchId: params.uploadBatchId,
    uploadFileId: params.uploadFileId,
    metadata: params.metadata,
    availableActions: actions,
  };
}
