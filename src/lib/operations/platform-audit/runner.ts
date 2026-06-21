import type { SupabaseClient } from "@supabase/supabase-js";
import { differenceInMinutes } from "date-fns";
import { getPlaybookForAccount, resolveNicheFromPlaybook } from "@/lib/ai/playbook";
import { getOwnerAccounts } from "@/lib/accounts";
import {
  buildAllAccountOperationalSummaries,
  filterPostsForAccount,
  isCriticalTikTokError,
} from "@/lib/operations/operational-summary";
import { computeOperationsSnapshot } from "@/lib/operations/compute";
import { getOwnerAccountRefs, getOwnerScheduledPosts, type OwnerAccountRef } from "@/lib/posts";
import { getOwnerTikTokAccounts } from "@/lib/tiktok/accounts";
import {
  ACTIVE_SLOT_STATUSES,
  slotTimeKey,
  slotTimeLabel,
} from "@/lib/schedule-slots";
import { getAppDateParts } from "@/lib/timezone";
import type { UploadBatch } from "@/lib/types";
import type {
  AuditFinding,
  AuditScope,
  AuditSummary,
  PlatformAuditResult,
} from "@/lib/operations/platform-audit/types";
import {
  filterFindingsByTier,
  inferTierFromFingerprint,
  TIER_POST_LIMIT,
  type AuditTier,
} from "@/lib/operations/platform-audit/tiers";
import type { ScheduledPost } from "@/lib/types";

const GENERIC_NICHE_MARKERS = [
  "marketing digital",
  "empreendedorismo",
  "conteúdo digital",
  "conteudodigital",
  "produtividade",
  "social media",
  "midiassociais",
];

const WARMUP_GRID_MINUTES = new Set([0, 15, 30, 45]);

function handle(ref: OwnerAccountRef | undefined, fallback = "conta") {
  if (!ref) return `@${fallback}`;
  const u = ref.username?.replace(/^@/, "") ?? fallback;
  return `@${u}`;
}

function findingId(parts: string[]) {
  return parts.filter(Boolean).join(":");
}

function scopeMatchesPlatform(scope: AuditScope, platform: string) {
  if (
    scope === "overview" ||
    scope === "schedule" ||
    scope === "uploads" ||
    scope === "publisher" ||
    scope === "database" ||
    scope === "ui"
  ) {
    return true;
  }
  if (scope === "tiktok") return platform === "tiktok";
  if (scope === "instagram") return platform === "instagram";
  return true;
}

function summarize(findings: AuditFinding[]): AuditSummary {
  const critical = findings.filter((f) => f.severity === "critical").length;
  const high = findings.filter((f) => f.severity === "high").length;
  const medium = findings.filter((f) => f.severity === "medium").length;
  const low = findings.filter((f) => f.severity === "low").length;
  const accountIds = new Set(
    findings.filter((f) => f.accountId && f.severity !== "low").map((f) => f.accountId!),
  );

  return {
    critical,
    high,
    medium,
    low,
    total: findings.length,
    accountsWithProblems: accountIds.size,
    healthyAccounts: 0,
    cronHealthy: !findings.some((f) => f.module === "cron" && f.severity === "critical"),
    stuckJobs: findings.filter((f) => f.title.toLowerCase().includes("job travado")).length,
    duplicateSlots: findings.filter((f) => f.title.toLowerCase().includes("duplicad")).length,
    invalidTokens: findings.filter((f) => f.module === "token" && f.severity === "critical").length,
  };
}

function looksLikeUtcStoredAsLocal(iso: string) {
  const date = new Date(iso);
  const utcH = date.getUTCHours();
  const utcM = date.getUTCMinutes();
  const br = getAppDateParts(date);
  return utcH === br.hour && utcM === br.minute && br.hour >= 6 && br.hour <= 23;
}

function captionHasDuplicateHashtags(post: ScheduledPost) {
  const caption = post.caption ?? "";
  const tagsField = post.hashtags ?? "";
  if (!caption || !tagsField) return false;
  const inCaption = caption.match(/#[\w\u00C0-\u017F]+/g) ?? [];
  if (!inCaption.length) return false;
  const normalizedField = tagsField.replace(/\s+/g, " ").trim().toLowerCase();
  const tail = inCaption.slice(-3).map((t) => t.toLowerCase());
  return tail.every((tag) => normalizedField.includes(tag));
}

export async function runPlatformAudit(params: {
  supabase: SupabaseClient;
  ownerId: string;
  scope?: AuditScope;
  tier?: AuditTier;
  onlyFingerprint?: string;
}): Promise<PlatformAuditResult> {
  const scope = params.scope ?? "overview";
  const tier = params.onlyFingerprint
    ? inferTierFromFingerprint(params.onlyFingerprint)
    : (params.tier ?? "full");
  const ranAt = new Date().toISOString();
  const findings: AuditFinding[] = [];
  const postsLimit = TIER_POST_LIMIT[tier];

  const [posts, refs, batchesRes, jobsRes, igAccounts, tiktokAccounts] = await Promise.all([
    getOwnerScheduledPosts(params.supabase, params.ownerId, {
      hiddenFromReport: false,
      order: "asc",
      limit: postsLimit,
    }),
    getOwnerAccountRefs(params.supabase, params.ownerId),
    params.supabase
      .from("upload_batches")
      .select("*")
      .eq("owner_id", params.ownerId)
      .order("created_at", { ascending: false })
      .limit(50),
    params.supabase
      .from("schedule_jobs")
      .select(
        "id, status, current_step, platform, account_id, tiktok_account_id, total_items, processed_items, completed_items, failed_items, locked_by, lock_until, last_heartbeat_at, updated_at, error_message, upload_batch_id",
      )
      .eq("owner_id", params.ownerId)
      .in("status", ["queued", "processing", "partial_failed"])
      .order("updated_at", { ascending: true }),
    getOwnerAccounts(params.supabase, params.ownerId),
    getOwnerTikTokAccounts(params.supabase, params.ownerId),
  ]);

  const batches = (batchesRes.data ?? []) as UploadBatch[];
  const jobs = jobsRes.data ?? [];
  const accountMap = new Map(refs.map((r) => [`${r.platform}:${r.id}`, r]));

  const summaries = await buildAllAccountOperationalSummaries({
    refs,
    igAccounts,
    tiktokAccounts,
    posts,
    ownerId: params.ownerId,
  });

  const snapshot = computeOperationsSnapshot(posts);
  const globalPending = posts.filter((p) =>
    ["pending", "retrying", "processing"].includes(p.status),
  ).length;

  if (tier === "schedule" || tier === "full") {
  for (const summary of summaries) {
    if (!scopeMatchesPlatform(scope, summary.platform)) continue;
    if (!summary.duplicateSlotCount) continue;

    for (const group of summary.duplicateSlots) {
      findings.push({
        id: findingId(["dup", summary.platform, summary.id, group.scheduledAt]),
        severity: "critical",
        module: "schedule",
        platform: summary.platform,
        accountId: summary.id,
        accountHandle: handle(accountMap.get(`${summary.platform}:${summary.id}`)),
        title: "Horários duplicados detectados",
        description: `Existem ${group.postIds.length} posts ativos no mesmo horário para a mesma conta/plataforma.`,
        evidence: {
          scheduledAt: group.scheduledAt,
          displayBrazil: slotTimeKey(group.scheduledAt).replace("T", " "),
          postIds: group.postIds,
        },
        probableCause: "Gerador de calendário não verificou slot ocupado antes de salvar.",
        recommendedFix:
          summary.platform === "tiktok"
            ? "Redistribuir via modo aquecimento (API fix-duplicate-slots) — não use SQL genérico +20min."
            : "Mover posts excedentes para o próximo slot livre em America/Sao_Paulo.",
        canAutoFix: true,
        requiresConfirmation: true,
        dryRunOnly: true,
      });
    }
  }

  for (const post of posts) {
    if (
      !post.scheduled_at ||
      !ACTIVE_SLOT_STATUSES.includes(post.status as (typeof ACTIVE_SLOT_STATUSES)[number])
    ) {
      continue;
    }
    const platform = post.platform ?? "instagram";
    if (!scopeMatchesPlatform(scope, platform)) continue;
    if (!looksLikeUtcStoredAsLocal(post.scheduled_at)) continue;

    const ref =
      platform === "tiktok"
        ? accountMap.get(`tiktok:${post.tiktok_account_id}`)
        : accountMap.get(`instagram:${post.account_id}`);

    findings.push({
      id: findingId(["tz", post.id]),
      severity: "critical",
      module: "schedule",
      platform,
      accountId:
        platform === "tiktok" ? post.tiktok_account_id ?? undefined : post.account_id ?? undefined,
      accountHandle: handle(ref),
      title: "Possível erro de timezone",
      description:
        "Horário salvo parece UTC mas deveria ser America/Sao_Paulo — publicação pode sair 3h antes/depois.",
      evidence: {
        scheduledAt: post.scheduled_at,
        displayBrazil: slotTimeLabel(post.scheduled_at),
        postId: post.id,
      },
      probableCause: "scheduled_at gravado como UTC em vez de instante correto para horário BR.",
      recommendedFix: "Recalcular scheduled_at usando America/Sao_Paulo antes de corrigir em massa.",
      canAutoFix: true,
      requiresConfirmation: true,
      dryRunOnly: true,
    });
  }

  for (const summary of summaries) {
    if (!scopeMatchesPlatform(scope, summary.platform)) continue;
    const active = filterPostsForAccount(posts, summary.id, summary.platform).filter((p) =>
      ACTIVE_SLOT_STATUSES.includes(p.status as (typeof ACTIVE_SLOT_STATUSES)[number]),
    );
    const offGrid = active.filter((p) => {
      const parts = getAppDateParts(new Date(p.scheduled_at));
      return !WARMUP_GRID_MINUTES.has(parts.minute);
    });
    if (offGrid.length < 5) continue;

    findings.push({
      id: findingId(["grid", summary.platform, summary.id]),
      severity: summary.platform === "tiktok" ? "high" : "medium",
      module: "schedule",
      platform: summary.platform,
      accountId: summary.id,
      accountHandle: handle(accountMap.get(`${summary.platform}:${summary.id}`)),
      title: "Posts fora da grade de horários",
      description: `${offGrid.length} posts ativos não usam slots :00/:15/:30/:45 (padrão aquecimento/auto).`,
      evidence: {
        sampleTimes: offGrid.slice(0, 8).map((p) => slotTimeLabel(p.scheduled_at)),
        postCount: offGrid.length,
      },
      probableCause: "Agendamento genérico (+20 min), reagendamento manual ou job retomado sem warmup.",
      recommendedFix:
        "Para TikTok em aquecimento: POST /api/scheduled-posts/fix-duplicate-slots com apply após preview.",
      canAutoFix: summary.platform === "tiktok",
      requiresConfirmation: true,
      dryRunOnly: true,
    });
  }
  }

  const now = Date.now();
  for (const job of jobs) {
    const platform = (job.platform ?? "instagram") as "instagram" | "tiktok";
    if (!scopeMatchesPlatform(scope, platform)) continue;

    const updatedAt = job.updated_at ? new Date(job.updated_at).getTime() : 0;
    const heartbeat = job.last_heartbeat_at ? new Date(job.last_heartbeat_at).getTime() : 0;
    const minutesStale = differenceInMinutes(now, updatedAt);
    const heartbeatStale = heartbeat ? differenceInMinutes(now, heartbeat) : minutesStale;
    const lockExpired = job.lock_until ? new Date(job.lock_until).getTime() < now : false;
    const stuck =
      minutesStale >= 10 ||
      heartbeatStale >= 5 ||
      (job.status === "processing" && lockExpired && Boolean(job.locked_by));

    if (!stuck) continue;

    const accountId = platform === "tiktok" ? job.tiktok_account_id : job.account_id;
    const ref = accountId ? accountMap.get(`${platform}:${accountId}`) : undefined;

    findings.push({
      id: findingId(["job", job.id]),
      severity: "critical",
      module: "schedule",
      platform,
      accountId: accountId ?? undefined,
      accountHandle: handle(ref),
      title: "Job de agendamento travado",
      description: `Job ${job.id.slice(0, 8)}… parado em "${job.current_step}" há ${minutesStale} min.`,
      evidence: {
        jobId: job.id,
        status: job.status,
        currentStep: job.current_step,
        processedItems: job.processed_items,
        totalItems: job.total_items,
        lockedBy: job.locked_by,
        lockUntil: job.lock_until,
        lastHeartbeatAt: job.last_heartbeat_at,
        updatedAt: job.updated_at,
        errorMessage: job.error_message,
      },
      probableCause: "Worker/cron interrompido, lock expirado ou falha silenciosa na fase atual.",
      recommendedFix:
        "Diagnosticar em /dashboard/operations/schedule-jobs — recuperar, liberar lock ou cancelar.",
      canAutoFix: false,
      requiresConfirmation: true,
      dryRunOnly: true,
    });
  }

  if (scope === "overview" || scope === "publisher") {
    const cronConfigured = Boolean(process.env.CRON_SECRET?.trim());
    if (!cronConfigured) {
      findings.push({
        id: "cron:not-configured",
        severity: "critical",
        module: "cron",
        platform: "system",
        title: "Cron de publicação não configurado",
        description: "CRON_SECRET ausente — publicações automáticas podem não executar.",
        evidence: { cronConfigured: false },
        probableCause: "Variável de ambiente não definida em produção.",
        recommendedFix: "Configure CRON_SECRET na Vercel e agendamentos pg_cron/vercel cron.",
        canAutoFix: false,
        requiresConfirmation: false,
        dryRunOnly: true,
      });
    }

    const overdue = posts.filter(
      (p) => p.status === "pending" && new Date(p.scheduled_at).getTime() < now,
    );
    if (overdue.length > 0) {
      findings.push({
        id: "cron:overdue-pending",
        severity: "high",
        module: "cron",
        platform: "system",
        title: "Posts pendentes atrasados",
        description: `${overdue.length} post(s) com horário no passado ainda em pending.`,
        evidence: { count: overdue.length, sampleIds: overdue.slice(0, 5).map((p) => p.id) },
        probableCause: "Cron parado, conta pausada ou fila bloqueada por erro crítico.",
        recommendedFix: "Verificar /api/health/publisher e logs de publish.",
        canAutoFix: false,
        requiresConfirmation: false,
        dryRunOnly: true,
      });
    }
  }

  for (const summary of summaries) {
    if (!scopeMatchesPlatform(scope, summary.platform)) continue;

    if (summary.platform === "tiktok" && isCriticalTikTokError(summary.lastError)) {
      const affected = filterPostsForAccount(posts, summary.id, "tiktok").filter(
        (p) =>
          isCriticalTikTokError(p.error_message) ||
          p.status === "failed" ||
          p.status === "failed_persistent" ||
          p.status === "retrying",
      );

      findings.push({
        id: findingId(["tt-url", summary.id]),
        severity: "critical",
        module: "publisher",
        platform: "tiktok",
        accountId: summary.id,
        accountHandle: handle(accountMap.get(`tiktok:${summary.id}`)),
        title: "TikTok url_ownership_unverified",
        description: "TikTok não validou a URL do vídeo — publicação bloqueada até verificar domínio.",
        evidence: {
          lastError: summary.lastError,
          affectedPosts: affected.slice(0, 10).map((p) => p.id),
          publishingPaused: summary.publishingPaused,
        },
        probableCause: "PULL_FROM_URL exige verificação de propriedade do domínio no TikTok Developers.",
        recommendedFix:
          "Verifique o domínio do storage em developers.tiktok.com ou migre para upload direto (FILE_UPLOAD).",
        canAutoFix: false,
        requiresConfirmation: false,
        dryRunOnly: true,
      });
    }

    if (summary.tokenStatus === "expired") {
      findings.push({
        id: findingId(["token", summary.platform, summary.id]),
        severity: "critical",
        module: "token",
        platform: summary.platform,
        accountId: summary.id,
        accountHandle: handle(accountMap.get(`${summary.platform}:${summary.id}`)),
        title: "Token inválido ou expirado",
        description: "Conta não pode publicar até reconectar.",
        evidence: { tokenStatus: summary.tokenStatus },
        probableCause: "OAuth expirado ou conta desconectada.",
        recommendedFix: "Reconectar conta em Contas → Validar permissões.",
        canAutoFix: false,
        requiresConfirmation: false,
        dryRunOnly: true,
      });
    }

    if (summary.publishingPaused) {
      findings.push({
        id: findingId(["paused", summary.platform, summary.id]),
        severity: "high",
        module: "publisher",
        platform: summary.platform,
        accountId: summary.id,
        accountHandle: handle(accountMap.get(`${summary.platform}:${summary.id}`)),
        title: "Publicação automática pausada",
        description: "Cron não publicará nesta conta até retomar.",
        evidence: { publishingPaused: true },
        probableCause: "Pausa manual ou automática por rate limit.",
        recommendedFix: "Retomar publicações em Operações → Pausa em massa.",
        canAutoFix: false,
        requiresConfirmation: true,
        dryRunOnly: true,
      });
    }

    if (
      tier === "full" &&
      summary.health === "healthy" &&
      (summary.failedCount > 0 ||
        summary.retryingCount > 0 ||
        summary.duplicateSlotCount > 0 ||
        isCriticalTikTokError(summary.lastError))
    ) {
      findings.push({
        id: findingId(["health-mismatch", summary.platform, summary.id]),
        severity: "high",
        module: "ui",
        platform: summary.platform,
        accountId: summary.id,
        accountHandle: handle(accountMap.get(`${summary.platform}:${summary.id}`)),
        title: "Status inconsistente",
        description: "Conta marcada como saudável mas há falhas, retry ou erro crítico.",
        evidence: {
          health: summary.health,
          failedCount: summary.failedCount,
          retryingCount: summary.retryingCount,
          duplicateSlotCount: summary.duplicateSlotCount,
          lastError: summary.lastError,
        },
        probableCause: "Métricas de saúde não consideram todos os sinais críticos.",
        recommendedFix: "Revisar deriveOperationalHealth — conta não deve ser 100% com erro crítico.",
        canAutoFix: false,
        requiresConfirmation: false,
        dryRunOnly: true,
      });
    }
  }

  if (tier === "full" && (scope === "overview" || scope === "ui")) {
    const perAccountPending = summaries.reduce((sum, s) => sum + s.pendingCount, 0);
    if (Math.abs(perAccountPending - globalPending) > 2) {
      findings.push({
        id: "counters:pending-mismatch",
        severity: "high",
        module: "ui",
        platform: "system",
        title: "Contadores de pendentes divergentes",
        description: `Soma por conta (${perAccountPending}) ≠ total global (${globalPending}).`,
        evidence: {
          perAccountPending,
          globalPending,
          snapshotPending: snapshot.pendingCount,
        },
        probableCause: "Filtros misturados, posts sem account_id ou contagem duplicada multiplataforma.",
        recommendedFix: "Usar ownerAllPosts sem filtro de conta nos totais globais.",
        canAutoFix: false,
        requiresConfirmation: false,
        dryRunOnly: true,
      });
    }
  }

  if (tier === "full") {
    for (const post of posts) {
      if (!captionHasDuplicateHashtags(post)) continue;
      const platform = post.platform ?? "instagram";
      if (!scopeMatchesPlatform(scope, platform)) continue;

      const ref =
        platform === "tiktok"
          ? accountMap.get(`tiktok:${post.tiktok_account_id}`)
          : accountMap.get(`instagram:${post.account_id}`);

      findings.push({
        id: findingId(["hash-dup", post.id]),
        severity: "medium",
        module: "ai",
        platform,
        accountId:
          platform === "tiktok" ? post.tiktok_account_id ?? undefined : post.account_id ?? undefined,
        accountHandle: handle(ref),
        title: "Hashtags duplicadas no card",
        description: "Hashtags aparecem na legenda e também no campo hashtags.",
        evidence: { postId: post.id },
        probableCause: "Renderização ou geração de legenda concatenou hashtags duas vezes.",
        recommendedFix: "Exibir hashtags uma vez — corpo sem bloco duplicado.",
        canAutoFix: true,
        requiresConfirmation: true,
        dryRunOnly: true,
      });
    }

    for (const summary of summaries) {
      if (!scopeMatchesPlatform(scope, summary.platform)) continue;
      const playbook = await getPlaybookForAccount(params.ownerId, summary.id);
      const niche = resolveNicheFromPlaybook(playbook)?.toLowerCase() ?? "";
      if (!niche.includes("curios")) continue;

      const accountPosts = filterPostsForAccount(posts, summary.id, summary.platform)
        .filter((p) => p.status === "pending")
        .slice(0, 40);

      const offNiche = accountPosts.filter((p) => {
        const text = `${p.caption ?? ""} ${p.hashtags ?? ""}`.toLowerCase();
        return GENERIC_NICHE_MARKERS.some((m) => text.includes(m));
      });

      if (offNiche.length < 3) continue;

      findings.push({
        id: findingId(["niche", summary.platform, summary.id]),
        severity: "high",
        module: "ai",
        platform: summary.platform,
        accountId: summary.id,
        accountHandle: handle(accountMap.get(`${summary.platform}:${summary.id}`)),
        title: "Legendas possivelmente fora do nicho",
        description: `${offNiche.length} posts com tom genérico de marketing digital em conta de curiosidades.`,
        evidence: {
          niche,
          samplePostIds: offNiche.slice(0, 5).map((p) => p.id),
        },
        probableCause: "Playbook errado, account_id incorreto na geração ou prompt genérico.",
        recommendedFix: "Verificar playbook vinculado à conta correta no Assistente de conteúdo.",
        canAutoFix: false,
        requiresConfirmation: false,
        dryRunOnly: true,
      });
    }
  }

  if (scope === "overview" || scope === "uploads") {
    for (const batch of batches) {
      if (batch.status === "uploading" || batch.status === "scheduling") {
        const updated = batch.updated_at ? new Date(batch.updated_at).getTime() : 0;
        if (now - updated > 20 * 60_000) {
          const platform = batch.platform ?? "instagram";
          if (!scopeMatchesPlatform(scope, platform)) continue;
          const accountId = platform === "tiktok" ? batch.tiktok_account_id : batch.account_id;
          findings.push({
            id: findingId(["upload", batch.id]),
            severity: "high",
            module: "upload",
            platform,
            accountId: accountId ?? undefined,
            accountHandle: handle(
              accountId ? accountMap.get(`${platform}:${accountId}`) : undefined,
            ),
            title: "Upload travado ou lento",
            description: `Lote ${batch.id.slice(0, 8)}… sem progresso há mais de 20 min.`,
            evidence: {
              uploadBatchId: batch.id,
              status: batch.status,
              updatedAt: batch.updated_at,
            },
            probableCause: "Conexão instável, arquivo grande ou sessão TUS expirada.",
            recommendedFix: "Verificar /dashboard/uploads e reconciliar lote.",
            canAutoFix: false,
            requiresConfirmation: true,
            dryRunOnly: true,
          });
        }
      }
    }
  }

  if (scope === "overview" || scope === "database") {
    const orphanPlatform = posts.filter(
      (p) => !p.platform || (p.platform === "tiktok" ? !p.tiktok_account_id : !p.account_id),
    );
    if (orphanPlatform.length) {
      findings.push({
        id: "db:orphan-posts",
        severity: "critical",
        module: "database",
        platform: "system",
        title: "Posts sem conta ou plataforma",
        description: `${orphanPlatform.length} registro(s) sem account_id/platform válidos.`,
        evidence: { postIds: orphanPlatform.slice(0, 10).map((p) => p.id) },
        probableCause: "Inserção parcial ou migração incompleta.",
        recommendedFix: "Associar posts à conta correta ou cancelar órfãos.",
        canAutoFix: false,
        requiresConfirmation: true,
        dryRunOnly: true,
      });
    }

    const nullSchedule = posts.filter(
      (p) => !p.scheduled_at && ["pending", "retrying", "processing"].includes(p.status),
    );
    if (nullSchedule.length) {
      findings.push({
        id: "db:null-schedule",
        severity: "critical",
        module: "database",
        platform: "system",
        title: "Posts ativos sem scheduled_at",
        description: `${nullSchedule.length} post(s) sem horário de agendamento.`,
        evidence: { postIds: nullSchedule.slice(0, 10).map((p) => p.id) },
        probableCause: "Job interrompido antes de gravar horários.",
        recommendedFix: "Finalizar job ou reagendar manualmente.",
        canAutoFix: false,
        requiresConfirmation: true,
        dryRunOnly: true,
      });
    }
  }

  const filtered = filterFindingsByScope(findings, scope);
  let tierFiltered = filterFindingsByTier(filtered, tier);
  if (params.onlyFingerprint) {
    tierFiltered = tierFiltered.filter((f) => f.id === params.onlyFingerprint);
  }

  const summary = summarize(tierFiltered);
  summary.healthyAccounts = summaries.filter(
    (s) => !tierFiltered.some((f) => f.accountId === s.id && f.severity !== "low"),
  ).length;

  console.info("[audit-start]", {
    ownerId: params.ownerId,
    scope,
    tier,
    findingCount: tierFiltered.length,
  });

  for (const f of tierFiltered.slice(0, 20)) {
    console.info("[audit-finding]", {
      id: f.id,
      severity: f.severity,
      platform: f.platform,
      module: f.module,
      account: f.accountHandle,
    });
  }

  return {
    dryRun: true,
    ranAt,
    scope,
    tier,
    ownerId: params.ownerId,
    summary,
    findings: tierFiltered,
    regression: {
      lastDeployCommit: process.env.VERCEL_GIT_COMMIT_SHA ?? null,
      lastDeployRef: process.env.VERCEL_GIT_COMMIT_REF ?? null,
      note: "Compare erros com data do deploy para identificar regressões.",
    },
  };
}

export function filterFindingsByScope(findings: AuditFinding[], scope: AuditScope): AuditFinding[] {
  if (scope === "overview") return findings;
  return findings.filter((f) => {
    if (scope === "tiktok") return f.platform === "tiktok";
    if (scope === "instagram") return f.platform === "instagram";
    if (scope === "schedule") return f.module === "schedule";
    if (scope === "uploads") return f.module === "upload";
    if (scope === "publisher") return f.module === "publisher" || f.module === "cron";
    if (scope === "database") return f.module === "database";
    if (scope === "ui") return f.module === "ui";
    return true;
  });
}
