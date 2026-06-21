"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, Loader2, Plus, UserRound, X } from "lucide-react";
import { useOptionalUploadSession } from "@/contexts/UploadSessionProvider";
import { getCompletedUploadItems, SupremeUploadManager } from "@/components/upload/SupremeUploadManager";
import { MultiplatformPreview } from "@/components/MultiplatformPreview";
import { ScheduleInsertionOverview } from "@/components/ScheduleInsertionOverview";
import { ScheduleStrategyPicker } from "@/components/ScheduleStrategyPicker";
import { WarmupScheduleOverview } from "@/components/WarmupScheduleOverview";
import {
  ProductCampaignSelector,
  type ProductCampaignSelection,
} from "@/components/products/ProductCampaignSelector";
import { ScheduleJobPanel } from "@/components/schedule/ScheduleJobPanel";
import { SCHEDULE_JOB_FORCE_THRESHOLD } from "@/lib/schedule-jobs/constants";
import {
  bootstrapScheduleJobTracking,
  createScheduleJobApi,
  findActiveScheduleJobForBatch,
} from "@/lib/schedule-jobs/client";
import type { ScheduleJobStatusResponse } from "@/lib/schedule-jobs/types";
import { refreshUploadBatch, updateBatchSchedule, markBatchFilesScheduled } from "@/lib/upload/client";
import type { PublishDestination } from "@/lib/multiplatform/types";
import type { MultiplatformVideoPreview } from "@/lib/multiplatform/types";
import { DESTINATION_LABELS } from "@/lib/multiplatform/types";
import { API_BATCH_SIZE } from "@/lib/autopilot-constants";
import {
  AUTO_MODE_SHORT_DESCRIPTION,
  AUTO_PROFILE_DESCRIPTIONS,
  AUTO_PROFILE_LABELS,
  DEFAULT_WARMUP_DAYS,
  inferAutoAccountProfile,
  WARMUP_MODE_SHORT_DESCRIPTION,
  type AutoAccountProfile,
} from "@/lib/account-warmup";
import { formatApiError } from "@/lib/api-errors";
import type { ScheduleInsertionPreview, ScheduleInsertionStrategy } from "@/lib/schedule-insertion";
import { deriveUploadSessionView } from "@/lib/upload/session-derived";
import { estimateScheduleDuration, parseTimeSlot, parseTimeSlots, countTodayAvailableSlots, buildEvenTimeSlotStrings, DEFAULT_CUSTOM_START_TIME, DEFAULT_CUSTOM_END_TIME, DEFAULT_CUSTOM_POSTS_PER_DAY } from "@/lib/smart-schedule";
import type { InstagramAccount, SocialPlatform, TikTokAccount, UploadBatch } from "@/lib/types";

interface Props {
  platform?: SocialPlatform;
  accounts: InstagramAccount[];
  tiktokAccounts?: TikTokAccount[];
  defaultAccountId?: string;
}

type ScheduleMode = "auto" | "warmup" | "today" | "custom";

const SCHEDULE_DRAFT_KEY = "postarigr-bulk-schedule-draft";

function buildDefaultCustomTimeSlots(
  postsPerDay = DEFAULT_CUSTOM_POSTS_PER_DAY,
  startTime = DEFAULT_CUSTOM_START_TIME,
  endTime = DEFAULT_CUSTOM_END_TIME,
) {
  return buildEvenTimeSlotStrings(startTime, endTime, postsPerDay);
}

const AI_TASKS = [
  "Criar legendas",
  "Gerar hashtags",
  "Definir horários",
  "Organizar calendário",
  "Publicar automaticamente",
] as const;

const PROGRESS_STEPS = [
  { id: "videos", label: (count: number) => `${count} vídeos recebidos` },
  { id: "captions", label: () => "Legendas sendo criadas" },
  { id: "hashtags", label: () => "Hashtags sendo geradas" },
  { id: "calendar", label: () => "Calendário sendo montado" },
  { id: "scheduling", label: () => "Agendamento em andamento" },
] as const;

async function apiFetch(input: RequestInfo | URL, init?: RequestInit) {
  const response = await fetch(input, { ...init, credentials: "include" });
  if (response.status === 401) {
    window.location.href = "/login?next=/dashboard/bulk";
    throw new Error("Sessão expirada. Faça login novamente.");
  }
  return response;
}

async function readJsonResponse(response: Response) {
  const text = await response.text();
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error(text.slice(0, 120) || "Resposta inválida do servidor");
  }
}

function chunkArray<T>(items: T[], size: number) {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

function sortTimes(times: string[]) {
  return [...times].sort((a, b) => {
    const left = parseTimeSlot(a);
    const right = parseTimeSlot(b);
    if (!left || !right) return 0;
    return left.hour * 60 + left.minute - (right.hour * 60 + right.minute);
  });
}

function modeLabel(mode: ScheduleMode) {
  if (mode === "auto") return "Automático";
  if (mode === "warmup") return "Aquecimento";
  if (mode === "custom") return "Personalizado";
  return "Publicar Hoje";
}

function formatDurationPreview(
  count: number,
  mode: ScheduleMode,
  warmupDays = DEFAULT_WARMUP_DAYS,
  customPostsPerDay = 15,
  customTimeSlots: string[] = buildDefaultCustomTimeSlots(),
  autoProfile: AutoAccountProfile = "growing",
) {
  if (!count) return { days: "", summary: "" };
  if (mode === "today") return { days: "Publicação ainda hoje", summary: "Hoje" };
  if (mode === "warmup") {
    const estimate = estimateScheduleDuration(count, "warmup", warmupDays);
    return { days: estimate.label, summary: estimate.shortLabel };
  }
  if (mode === "custom") {
    const estimate = estimateScheduleDuration(count, "custom", warmupDays, {
      postsPerDay: customPostsPerDay,
      timeSlots: parseTimeSlots(customTimeSlots),
    });
    return {
      days: estimate.label || `≈ ${Math.ceil(count / customPostsPerDay)} dias de conteúdo`,
      summary: estimate.shortLabel || `~${Math.ceil(count / customPostsPerDay)} dias`,
    };
  }
  if (mode === "auto") {
    const estimate = estimateScheduleDuration(count, "auto", warmupDays, undefined, {
      profile: autoProfile,
    });
    return { days: estimate.label, summary: estimate.shortLabel };
  }
  const minDays = Math.ceil(count / 2);
  const maxDays = count;
  const minMonths = Math.max(1, Math.round(minDays / 30));
  const maxMonths = Math.max(minMonths, Math.round(maxDays / 30));
  return {
    days: `≈ ${minDays} a ${maxDays} dias de conteúdo`,
    summary:
      minMonths === maxMonths
        ? `~${minMonths} mês${minMonths > 1 ? "es" : ""} de conteúdo`
        : `${minMonths} a ${maxMonths} meses de conteúdo`,
  };
}

function readScheduleDraft(platform: SocialPlatform, accountId: string) {
  if (typeof window === "undefined" || !accountId) return null;
  try {
    const raw = sessionStorage.getItem(`${SCHEDULE_DRAFT_KEY}:${platform}:${accountId}`);
    if (!raw) return null;
    return JSON.parse(raw) as {
      scheduleMode: ScheduleMode;
      customPostsPerDay: number;
      customStartTime: string;
      customEndTime: string;
      customTimeSlots: string[];
    };
  } catch {
    return null;
  }
}

function writeScheduleDraft(
  platform: SocialPlatform,
  accountId: string,
  draft: {
    scheduleMode: ScheduleMode;
    customPostsPerDay: number;
    customStartTime: string;
    customEndTime: string;
    customTimeSlots: string[];
  },
) {
  if (typeof window === "undefined" || !accountId) return;
  sessionStorage.setItem(`${SCHEDULE_DRAFT_KEY}:${platform}:${accountId}`, JSON.stringify(draft));
}

function applyBatchSchedule(batch: UploadBatch) {
  const nextMode = batch.schedule_mode;
  const nextPosts = batch.custom_schedule?.posts_per_day ?? DEFAULT_CUSTOM_POSTS_PER_DAY;
  const nextStart = batch.custom_schedule?.start_time ?? DEFAULT_CUSTOM_START_TIME;
  const nextEnd = batch.custom_schedule?.end_time ?? DEFAULT_CUSTOM_END_TIME;
  const nextSlots =
    batch.custom_schedule?.time_slots?.length
      ? batch.custom_schedule.time_slots
      : buildDefaultCustomTimeSlots(nextPosts, nextStart, nextEnd);
  return {
    scheduleMode: nextMode,
    customPostsPerDay: nextPosts,
    customStartTime: nextStart,
    customEndTime: nextEnd,
    customTimeSlots: nextSlots,
  };
}

function batchSummaryEqual(a: UploadBatch | null, b: UploadBatch | null) {
  if (a === b) return true;
  if (!a || !b) return false;
  const aFileCount = a.upload_files?.length ?? 0;
  const bFileCount = b.upload_files?.length ?? 0;
  if (aFileCount !== bFileCount) return false;
  return (
    a.id === b.id &&
    a.status === b.status &&
    a.completed_files === b.completed_files &&
    a.failed_files === b.failed_files &&
    a.total_files === b.total_files &&
    a.schedule_mode === b.schedule_mode &&
    a.paused === b.paused &&
    JSON.stringify(a.custom_schedule) === JSON.stringify(b.custom_schedule)
  );
}

export function BulkUploadForm({
  platform = "instagram",
  accounts,
  tiktokAccounts = [],
  defaultAccountId,
}: Props) {
  const initialDestination: PublishDestination =
    platform === "tiktok" ? "tiktok" : "instagram";

  const [destinationMode, setDestinationMode] = useState<PublishDestination>(initialDestination);
  const [selectedInstagramId, setSelectedInstagramId] = useState(
    () =>
      (defaultAccountId && accounts.some((a) => a.id === defaultAccountId)
        ? defaultAccountId
        : accounts[0]?.id) ?? "",
  );
  const [selectedTiktokId, setSelectedTiktokId] = useState(
    () =>
      (defaultAccountId && tiktokAccounts.some((a) => a.id === defaultAccountId)
        ? defaultAccountId
        : tiktokAccounts[0]?.id) ?? "",
  );

  const uploadPlatform: SocialPlatform =
    destinationMode === "tiktok" ? "tiktok" : "instagram";
  const uploadAccountId =
    destinationMode === "tiktok" ? selectedTiktokId : selectedInstagramId;

  const activeAccounts = uploadPlatform === "tiktok" ? tiktokAccounts : accounts;

  const initialAccountId = useMemo(() => uploadAccountId, [uploadAccountId]);

  const draft = useMemo(
    () => readScheduleDraft(uploadPlatform, initialAccountId),
    [uploadPlatform, initialAccountId],
  );

  const [scheduleMode, setScheduleMode] = useState<ScheduleMode>(draft?.scheduleMode ?? "auto");
  const [autoProfile, setAutoProfile] = useState<AutoAccountProfile>("growing");
  const [customPostsPerDay, setCustomPostsPerDay] = useState(
    draft?.customPostsPerDay ?? DEFAULT_CUSTOM_POSTS_PER_DAY,
  );
  const [customStartTime, setCustomStartTime] = useState(
    draft?.customStartTime ?? DEFAULT_CUSTOM_START_TIME,
  );
  const [customEndTime, setCustomEndTime] = useState(
    draft?.customEndTime ?? DEFAULT_CUSTOM_END_TIME,
  );
  const [customTimeSlots, setCustomTimeSlots] = useState<string[]>(
    draft?.customTimeSlots ??
      buildDefaultCustomTimeSlots(
        draft?.customPostsPerDay ?? DEFAULT_CUSTOM_POSTS_PER_DAY,
        draft?.customStartTime ?? DEFAULT_CUSTOM_START_TIME,
        draft?.customEndTime ?? DEFAULT_CUSTOM_END_TIME,
      ),
  );
  const [newTimeInput, setNewTimeInput] = useState("");
  const [selectedAccountId, setSelectedAccountId] = useState(initialAccountId);
  const [previewVideos, setPreviewVideos] = useState<MultiplatformVideoPreview[] | null>(null);
  const [previewSummary, setPreviewSummary] = useState("");
  const [previewTotalPosts, setPreviewTotalPosts] = useState(0);
  const [previewItems, setPreviewItems] = useState<Array<{ media_urls: string[]; filename: string }>>(
    [],
  );
  const [previewWarmupBreakdown, setPreviewWarmupBreakdown] = useState<
    Array<{ day: number; dateLabel: string; posts: number; times: string[] }> | null
  >(null);
  const [insertionPreview, setInsertionPreview] = useState<ScheduleInsertionPreview | null>(null);
  const [scheduleStrategy, setScheduleStrategy] = useState<ScheduleInsertionStrategy>("continue");
  const [showStrategyPicker, setShowStrategyPicker] = useState(false);
  const [pendingSchedulePartial, setPendingSchedulePartial] = useState(false);
  const [confirmingPreview, setConfirmingPreview] = useState(false);
  const [campaignSelection, setCampaignSelection] = useState<ProductCampaignSelection>({
    productId: null,
    campaignId: null,
    contentObjective: null,
  });
  const [activeBatch, setActiveBatch] = useState<UploadBatch | null>(null);
  const restoredBatchIdRef = useRef<string | null>(null);
  const handleScheduleRef = useRef<(partial?: boolean) => Promise<void>>(async () => {});
  const [isUploading, setIsUploading] = useState(false);
  const [scheduling, setScheduling] = useState(false);
  const [loadingStep, setLoadingStep] = useState("");
  const [progress, setProgress] = useState(0);
  const [completedSteps, setCompletedSteps] = useState<string[]>([]);
  const [result, setResult] = useState<string | null>(null);
  const [captionSource, setCaptionSource] = useState<"ai" | "fallback" | null>(null);
  const [scheduleJobId, setScheduleJobId] = useState<string | null>(null);
  const [scheduleJobInitialStatus, setScheduleJobInitialStatus] =
    useState<ScheduleJobStatusResponse | null>(null);
  const [scheduleJobNotice, setScheduleJobNotice] = useState<string | null>(null);

  useEffect(() => {
    setSelectedAccountId(uploadAccountId);
  }, [uploadAccountId]);

  const selectedAccount =
    activeAccounts.find((account) => account.id === selectedAccountId) ?? activeAccounts[0];
  const selectedUsername =
    uploadPlatform === "tiktok"
      ? (selectedAccount as TikTokAccount | undefined)?.username ??
        (selectedAccount as TikTokAccount | undefined)?.display_name ??
        "conta"
      : (selectedAccount as InstagramAccount | undefined)?.ig_username ?? "conta";
  const warmupDays =
    destinationMode !== "tiktok"
      ? ((accounts.find((a) => a.id === selectedInstagramId) as InstagramAccount | undefined)
          ?.warmup_days ?? DEFAULT_WARMUP_DAYS)
      : DEFAULT_WARMUP_DAYS;

  const selectedIgAccount =
    (accounts.find((a) => a.id === selectedInstagramId) as InstagramAccount | undefined) ?? null;

  useEffect(() => {
    if (selectedIgAccount) {
      setAutoProfile(inferAutoAccountProfile(selectedIgAccount));
    }
  }, [selectedIgAccount?.id]);

  const canUseInstagram = accounts.length > 0;
  const canUseTiktok = tiktokAccounts.length > 0;
  const destinationReady =
    destinationMode === "instagram"
      ? canUseInstagram && Boolean(selectedInstagramId)
      : destinationMode === "tiktok"
        ? canUseTiktok && Boolean(selectedTiktokId)
        : canUseInstagram && canUseTiktok && Boolean(selectedInstagramId) && Boolean(selectedTiktokId);
  const selectedAvatar = selectedAccount?.profile_picture_url ?? null;
  const uploadSession = useOptionalUploadSession();

  const uploadView = useMemo(() => {
    if (!uploadSession?.batch) return null;
    if (activeBatch?.id && uploadSession.batch.id !== activeBatch.id) return null;
    return deriveUploadSessionView({
      batch: uploadSession.batch,
      progress: uploadSession.progress,
      progressMap: uploadSession.progressMap,
      running: uploadSession.running,
      pausedByUser: uploadSession.pausedByUser,
      retrying: uploadSession.retrying,
      resuming: uploadSession.resuming,
      canResumeWithoutPicker: uploadSession.canResumeWithoutPicker,
      needsFileReselection: uploadSession.needsFileReselection,
    });
  }, [uploadSession, activeBatch?.id]);

  const liveBatch =
    uploadSession?.batch?.id === activeBatch?.id ? uploadSession?.batch ?? activeBatch : activeBatch;

  const completedCount = uploadView?.completedCount ?? liveBatch?.completed_files ?? activeBatch?.completed_files ?? 0;
  const totalCount = uploadView?.totalCount ?? liveBatch?.total_files ?? activeBatch?.total_files ?? 0;
  const failedCount = uploadView?.failedCount ?? liveBatch?.failed_files ?? activeBatch?.failed_files ?? 0;
  const remainingUploadCount = uploadView
    ? uploadView.stats.pendingFiles +
      uploadView.stats.uploadingFiles +
      uploadView.stats.retryingFiles +
      uploadView.stats.stalledFiles
    : Math.max(0, totalCount - completedCount - (liveBatch?.failed_files ?? activeBatch?.failed_files ?? 0));
  const batchReady = activeBatch?.status === "ready";
  const uploadSettled = !isUploading && !uploadSession?.retrying && remainingUploadCount === 0;
  const canSchedulePartial = completedCount > 0 && !uploadSettled;
  const canScheduleAll = completedCount > 0 && uploadSettled;

  const effectiveScheduleMode = activeBatch?.schedule_mode ?? scheduleMode;
  const effectiveCustomPostsPerDay =
    activeBatch?.custom_schedule?.posts_per_day ?? customPostsPerDay;
  const effectiveCustomTimeSlots =
    activeBatch?.custom_schedule?.time_slots?.length
      ? activeBatch.custom_schedule.time_slots
      : customTimeSlots;

  const durationPreview = formatDurationPreview(
    totalCount || completedCount,
    effectiveScheduleMode,
    warmupDays,
    effectiveCustomPostsPerDay,
    effectiveCustomTimeSlots,
    autoProfile,
  );

  const customSchedulePayload = useMemo(
    () =>
      scheduleMode === "custom"
        ? {
            posts_per_day: customPostsPerDay,
            start_time: customStartTime,
            end_time: customEndTime,
            time_slots: customTimeSlots,
          }
        : null,
    [scheduleMode, customPostsPerDay, customStartTime, customEndTime, customTimeSlots],
  );

  const handleBatchUpdate = useCallback((batch: UploadBatch | null) => {
    setActiveBatch((prev) => (batchSummaryEqual(prev, batch) ? prev : batch));
  }, []);

  const handleUploadingChange = useCallback((uploading: boolean) => {
    setIsUploading(uploading);
  }, []);

  useEffect(() => {
    if (!activeBatch || restoredBatchIdRef.current === activeBatch.id) return;
    restoredBatchIdRef.current = activeBatch.id;
    const restored = applyBatchSchedule(activeBatch);
    setScheduleMode(restored.scheduleMode);
    setCustomPostsPerDay(restored.customPostsPerDay);
    setCustomStartTime(restored.customStartTime);
    setCustomEndTime(restored.customEndTime);
    setCustomTimeSlots(restored.customTimeSlots);
    writeScheduleDraft(uploadPlatform, selectedAccountId, restored);
  }, [activeBatch, uploadPlatform, selectedAccountId]);

  useEffect(() => {
    writeScheduleDraft(uploadPlatform, selectedAccountId, {
      scheduleMode,
      customPostsPerDay,
      customStartTime,
      customEndTime,
      customTimeSlots,
    });
  }, [uploadPlatform, selectedAccountId, scheduleMode, customPostsPerDay, customStartTime, customEndTime, customTimeSlots]);

  function buildCustomSchedulePayload(
    postsPerDay: number,
    startTime: string,
    endTime: string,
    timeSlots: string[],
  ) {
    return {
      posts_per_day: postsPerDay,
      start_time: startTime,
      end_time: endTime,
      time_slots: timeSlots,
    };
  }

  async function persistSchedule(
    mode: ScheduleMode,
    postsPerDay: number,
    startTime: string,
    endTime: string,
    timeSlots: string[],
  ) {
    if (!activeBatch) return;
    try {
      const updated = await updateBatchSchedule(activeBatch.id, {
        schedule_mode: mode,
        custom_schedule:
          mode === "custom"
            ? buildCustomSchedulePayload(postsPerDay, startTime, endTime, timeSlots)
            : null,
      });
      setActiveBatch((prev) => (batchSummaryEqual(prev, updated) ? prev : updated));
    } catch (error) {
      setResult(error instanceof Error ? error.message : "Falha ao salvar modo de publicação");
    }
  }

  async function changeScheduleMode(mode: ScheduleMode) {
    setScheduleMode(mode);
    await persistSchedule(mode, customPostsPerDay, customStartTime, customEndTime, customTimeSlots);
  }

  async function applyCustomScheduleRange(
    postsPerDay: number,
    startTime: string,
    endTime: string,
  ) {
    const nextSlots = buildDefaultCustomTimeSlots(postsPerDay, startTime, endTime);
    setCustomPostsPerDay(postsPerDay);
    setCustomStartTime(startTime);
    setCustomEndTime(endTime);
    setCustomTimeSlots(nextSlots);
    if (scheduleMode === "custom") {
      await persistSchedule("custom", postsPerDay, startTime, endTime, nextSlots);
    }
  }

  async function changeCustomPostsPerDay(value: number) {
    const safeValue = Math.max(1, Math.min(100, value));
    await applyCustomScheduleRange(safeValue, customStartTime, customEndTime);
  }

  async function changeCustomTimeRange(startTime: string, endTime: string) {
    await applyCustomScheduleRange(customPostsPerDay, startTime, endTime);
  }

  async function changeCustomTimeSlots(next: string[]) {
    setCustomTimeSlots(next);
    if (scheduleMode === "custom") {
      await persistSchedule("custom", customPostsPerDay, customStartTime, customEndTime, next);
    }
  }

  function markStep(stepId: string) {
    setCompletedSteps((current) => (current.includes(stepId) ? current : [...current, stepId]));
  }

  function buildSchedulePayload(mode = effectiveScheduleMode) {
    if (mode === "custom") {
      return {
        custom_schedule: buildCustomSchedulePayload(
          effectiveCustomPostsPerDay,
          activeBatch?.custom_schedule?.start_time ?? customStartTime,
          activeBatch?.custom_schedule?.end_time ?? customEndTime,
          effectiveCustomTimeSlots,
        ),
      };
    }
    if (mode === "auto") {
      return { auto_profile: autoProfile };
    }
    return {};
  }

  function addCustomTime() {
    const normalized = newTimeInput.trim();
    if (!parseTimeSlot(normalized)) {
      setResult("Use o formato HH:mm, por exemplo 06:15 ou 20:45.");
      return;
    }
    if (customTimeSlots.includes(normalized)) {
      setNewTimeInput("");
      return;
    }
    const next = sortTimes([...customTimeSlots, normalized]);
    void changeCustomTimeSlots(next);
    setNewTimeInput("");
    setResult(null);
  }

  function buildCampaignPayload() {
    return {
      product_id: campaignSelection.productId,
      campaign_id: campaignSelection.campaignId,
      content_objective: campaignSelection.contentObjective,
    };
  }

  function batchScheduledCount() {
    return (
      (liveBatch ?? activeBatch)?.upload_files?.filter((file) => file.removed).length ?? 0
    );
  }

  function buildInsertionPayload() {
    return {
      upload_batch_id: activeBatch?.id ?? null,
      schedule_strategy: scheduleStrategy,
      batch_scheduled_count: batchScheduledCount(),
    };
  }

  function buildScheduleJobPayload(partial = false, batchId?: string) {
    return {
      upload_batch_id: batchId ?? activeBatch?.id ?? uploadSession?.batch?.id ?? "",
      targets: buildMultiplatformTargets(),
      schedule_mode: effectiveScheduleMode,
      ...buildSchedulePayload(),
      ...buildCampaignPayload(),
      schedule_strategy: scheduleStrategy,
      batch_scheduled_count: batchScheduledCount(),
      partial,
    };
  }

  async function refreshActiveBatch() {
    if (!activeBatch?.id) return;
    const batch = await refreshUploadBatch(activeBatch.id).catch(() => null);
    if (batch) handleBatchUpdate(batch);
  }

  useEffect(() => {
    if (!activeBatch?.id) {
      setScheduleJobId(null);
      return;
    }
    let cancelled = false;
    void findActiveScheduleJobForBatch(activeBatch.id).then((jobId) => {
      if (!cancelled && jobId) setScheduleJobId(jobId);
    });
    return () => {
      cancelled = true;
    };
  }, [activeBatch?.id]);

  function handleScheduleJobComplete(status: ScheduleJobStatusResponse) {
    if (status.phase === "completed") {
      setResult(`✓ ${status.postsSaved} posts salvos no calendário.`);
    } else if (status.phase === "partial_completed") {
      setResult(
        `${status.postsSaved} posts salvos. ${status.failed} com erro — use Retomar agendamento.`,
      );
    }
    void refreshActiveBatch();
  }

  async function runScheduleJobFlow(
    batchId: string,
    items: Array<{ media_urls: string[]; filename: string }>,
    partial = false,
    videoCount = items.length,
  ) {
    markStep("videos");
    setScheduleJobNotice(null);

    const created = await createScheduleJobApi(buildScheduleJobPayload(partial, batchId));
    setScheduleJobId(created.jobId);
    setScheduleJobInitialStatus(created.status ?? null);
    setResult(null);
    setLoadingStep("Agendamento iniciado…");

    void bootstrapScheduleJobTracking(created.jobId, videoCount).then((initialStatus) => {
      setScheduleJobInitialStatus(initialStatus);
      setProgress(Math.min(90, Math.max(15, initialStatus.progressPercent)));
      setLoadingStep(initialStatus.progressLabel || "Preparando publicações…");
    });

    if (created.reused) {
      const msg =
        "alreadyCompleted" in created && created.alreadyCompleted
          ? "Agendamento já concluído para este lote."
          : "Agendamento em andamento — acompanhe o progresso abaixo.";
      setScheduleJobNotice(msg);
    } else if (created.message) {
      setScheduleJobNotice(created.message);
    }
    markStep("captions");
    markStep("hashtags");
    markStep("calendar");
    setProgress(15);
    setLoadingStep("Preparando publicações…");
  }

  async function confirmAutopilotBatch(params: {
    items: Array<{ media_urls: string[]; filename: string }>;
    captions: string[];
    schedule: string[];
  }) {
    const autopilotRes = await apiFetch("/api/posts/autopilot", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        platform: uploadPlatform,
        account_ids: [
          uploadPlatform === "tiktok" ? selectedTiktokId : selectedInstagramId,
        ],
        schedule_mode: effectiveScheduleMode,
        items: params.items,
        captions: params.captions,
        schedule: params.schedule,
        ...buildSchedulePayload(),
        ...buildCampaignPayload(),
        ...buildInsertionPayload(),
      }),
    });
    const autopilotData = await readJsonResponse(autopilotRes);
    if (!autopilotRes.ok) {
      throw new Error(formatApiError(autopilotData.error) || "Falha ao confirmar agendamento");
    }
    return Number(autopilotData.created ?? 0);
  }

  async function runAutopilot(items: Array<{ media_urls: string[]; filename: string }>) {
    const total = items.length;
    const batches = chunkArray(items, API_BATCH_SIZE);
    let totalCreated = 0;
    let lastScheduleSummary = "";

    markStep("captions");
    markStep("hashtags");

    for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
      const batchItems = batches[batchIndex];
      const offset = batchIndex * API_BATCH_SIZE;

      setLoadingStep("A IA está montando legendas, hashtags e horários...");
      setProgress(30 + Math.round(((batchIndex + 0.5) / batches.length) * 40));
      markStep("calendar");

      const previewRes = await apiFetch("/api/posts/autopilot/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          platform: uploadPlatform,
          account_ids: [
          uploadPlatform === "tiktok" ? selectedTiktokId : selectedInstagramId,
        ],
          schedule_mode: effectiveScheduleMode,
          items: batchItems,
          batch_offset: offset,
          total_count: total,
          ...buildSchedulePayload(),
          ...buildCampaignPayload(),
          ...buildInsertionPayload(),
        }),
      });

      const previewData = await readJsonResponse(previewRes);
      if (!previewRes.ok) {
        throw new Error(formatApiError(previewData.error) || "Falha ao gerar plano IA");
      }

      if (previewData.caption_source === "fallback") {
        setCaptionSource("fallback");
      } else if (previewData.caption_source === "ai") {
        setCaptionSource("ai");
      }

      if (previewData.insertion_preview && batchIndex === 0) {
        setInsertionPreview(previewData.insertion_preview as ScheduleInsertionPreview);
      }

      const entries = (previewData.preview as Array<{ caption: string }>) ?? [];
      const schedule = (previewData.schedule as string[]) ?? [];
      lastScheduleSummary = String(previewData.schedule_summary ?? "");

      setLoadingStep("Agendando publicações...");
      setProgress(75 + Math.round((batchIndex / batches.length) * 20));
      markStep("scheduling");

      totalCreated += await confirmAutopilotBatch({
        items: batchItems,
        captions: entries.map((entry) => entry.caption),
        schedule,
      });
    }

    setProgress(100);
    return { totalCreated, lastScheduleSummary };
  }

  function buildMultiplatformTargets() {
    if (destinationMode === "both") {
      return [
        { platform: "instagram" as const, account_id: selectedInstagramId },
        { platform: "tiktok" as const, account_id: selectedTiktokId },
      ];
    }
    if (destinationMode === "tiktok") {
      return [{ platform: "tiktok" as const, account_id: selectedTiktokId }];
    }
    return [{ platform: "instagram" as const, account_id: selectedInstagramId }];
  }

  async function runMultiplatformPreview(
    items: Array<{ media_urls: string[]; filename: string }>,
  ) {
    const targets = buildMultiplatformTargets();
    const batches = chunkArray(items, API_BATCH_SIZE);
    const allVideos: MultiplatformVideoPreview[] = [];
    const skippedPreviewErrors: string[] = [];
    let lastScheduleSummary = "";
    let source: "ai" | "fallback" = "ai";

    markStep("captions");
    markStep("hashtags");

    for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
      const batchItems = batches[batchIndex];
      const offset = batchIndex * API_BATCH_SIZE;

      setLoadingStep("Gerando legendas e horários por plataforma...");
      setProgress(30 + Math.round(((batchIndex + 0.5) / batches.length) * 50));
      markStep("calendar");

      try {
        const previewRes = await apiFetch("/api/posts/multiplatform/preview", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            targets,
            schedule_mode: effectiveScheduleMode,
            items: batchItems,
            batch_offset: offset,
            total_count: items.length,
            ...buildSchedulePayload(),
            ...buildCampaignPayload(),
            ...buildInsertionPayload(),
          }),
        });

        const previewData = await readJsonResponse(previewRes);
        if (!previewRes.ok) {
          throw new Error(formatApiError(previewData.error) || "Falha ao gerar prévia");
        }

        if (previewData.caption_source === "fallback") source = "fallback";
        allVideos.push(...((previewData.preview as MultiplatformVideoPreview[]) ?? []));
        lastScheduleSummary = String(previewData.schedule_summary ?? "");
        if (previewData.warmup_breakdown) {
          setPreviewWarmupBreakdown(
            previewData.warmup_breakdown as Array<{
              day: number;
              dateLabel: string;
              posts: number;
              times: string[];
            }>,
          );
        }
        if (previewData.insertion_preview && batchIndex === 0) {
          setInsertionPreview(previewData.insertion_preview as ScheduleInsertionPreview);
        }
      } catch (error) {
        skippedPreviewErrors.push(
          `Lote ${batchIndex + 1} (${batchItems.length} vídeo(s)): ${
            error instanceof Error ? error.message : "Erro desconhecido"
          }`,
        );
      }
    }

    if (!allVideos.length) {
      throw new Error(
        skippedPreviewErrors[0] ?? "Não foi possível gerar a prévia de agendamento.",
      );
    }

    if (skippedPreviewErrors.length) {
      setResult(
        `${skippedPreviewErrors.length} vídeo(s) ignorados por erro. Prévia gerada para ${allVideos.length} vídeo(s).`,
      );
    }

    setCaptionSource(source);
    setPreviewVideos(allVideos);
    setPreviewSummary(lastScheduleSummary);
    setPreviewTotalPosts(
      allVideos.reduce((sum, video) => sum + video.destinations.length, 0),
    );
    setPreviewItems(
      items.filter((item) =>
        allVideos.some((video) => video.filename === item.filename || video.media_urls[0] === item.media_urls[0]),
      ),
    );
    if (effectiveScheduleMode !== "warmup" && effectiveScheduleMode !== "auto") {
      setPreviewWarmupBreakdown(null);
    }
    setProgress(100);
  }

  async function confirmMultiplatformPreview() {
    if (!previewVideos?.length) return { created: 0, skippedVideos: 0 };

    setConfirmingPreview(true);
    try {
      const confirmRes = await apiFetch("/api/posts/multiplatform/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          videos: previewVideos.map((video) => ({
            parent_publish_group_id: video.parent_publish_group_id,
            media_urls: video.media_urls,
            filename: video.filename,
            destinations: video.destinations.map((dest) => ({
              platform: dest.platform,
              account_id: dest.account_id,
              caption: dest.caption,
              scheduled_at: dest.scheduled_at,
            })),
          })),
          ...buildCampaignPayload(),
          upload_batch_id: activeBatch?.id ?? null,
        }),
      });

      const confirmData = await readJsonResponse(confirmRes);
      if (!confirmRes.ok) {
        throw new Error(formatApiError(confirmData.error) || "Falha ao confirmar agendamento");
      }

      if (activeBatch?.id && previewItems.length) {
        const scheduledUrls = previewVideos.flatMap((video) => video.media_urls);
        await markBatchFilesScheduled(activeBatch.id, scheduledUrls).catch(() => undefined);
      }

      return {
        created: Number(confirmData.created ?? 0),
        skippedVideos: Number(confirmData.skipped_videos ?? 0),
      };
    } finally {
      setConfirmingPreview(false);
    }
  }

  function handlePreviewCaptionChange(
    videoIndex: number,
    platform: "instagram" | "tiktok",
    caption: string,
  ) {
    setPreviewVideos((current) =>
      current?.map((video) =>
        video.index === videoIndex
          ? {
              ...video,
              destinations: video.destinations.map((dest) =>
                dest.platform === platform ? { ...dest, caption } : dest,
              ),
            }
          : video,
      ) ?? null,
    );
  }

  async function executeSchedule(partial = false) {
    const batchId = activeBatch?.id ?? uploadSession?.batch?.id;
    if (!batchId || !destinationReady) return;

    let batchWithFiles: UploadBatch;
    try {
      batchWithFiles = await refreshUploadBatch(batchId);
      handleBatchUpdate(batchWithFiles);
    } catch (error) {
      setResult(error instanceof Error ? error.message : "Falha ao carregar vídeos do lote.");
      return;
    }

    const items = getCompletedUploadItems(batchWithFiles);
    const serverReady = batchWithFiles.completed_files ?? 0;
    const readyCount = Math.max(items.length, serverReady);

    if (readyCount <= 0) {
      setResult("Nenhum vídeo concluído neste lote. Verifique o upload antes de agendar.");
      return;
    }

    const useJobQueue = readyCount >= SCHEDULE_JOB_FORCE_THRESHOLD;

    if (!items.length && !useJobQueue) {
      setResult(
        "Não foi possível carregar os links dos vídeos enviados. Atualize a página e tente novamente.",
      );
      return;
    }

    if (effectiveScheduleMode === "today") {
      const maxToday = countTodayAvailableSlots();
      const countToSchedule = items.length || readyCount;
      if (countToSchedule > maxToday) {
        setResult(
          `Só há espaço para ${maxToday} post(s) hoje. Use "Automático" ou envie menos vídeos.`,
        );
        return;
      }
    }

    if (effectiveScheduleMode === "custom") {
      if (effectiveCustomPostsPerDay < 1 || effectiveCustomPostsPerDay > 100) {
        setResult("Posts por dia deve ficar entre 1 e 100.");
        return;
      }
      if (!parseTimeSlots(effectiveCustomTimeSlots).length) {
        setResult("Adicione pelo menos um horário válido no modo personalizado.");
        return;
      }
    }

    setScheduling(true);
    setResult(null);
    setScheduleJobNotice(null);
    setProgress(0);
    setCompletedSteps([]);
    setInsertionPreview(null);
    markStep("videos");

    try {
      if (useJobQueue) {
        await runScheduleJobFlow(batchId, items, partial, items.length || readyCount);
        setScheduling(false);
        setLoadingStep("");
        return;
      }
      await runMultiplatformPreview(items);
      setScheduling(false);
      setLoadingStep("");
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Erro desconhecido";
      if (message.toLowerCase().includes("failed to fetch")) {
        setResult(
          'Ainda estamos finalizando seu agendamento. Seu progresso foi salvo com segurança. Se a tela não atualizar em alguns segundos, clique em "Retomar agendamento".',
        );
      } else {
        setResult(message);
      }
    } finally {
      setScheduling(false);
      setLoadingStep("");
    }
  }

  async function handleSchedule(partial = false) {
    const batchId = activeBatch?.id ?? uploadSession?.batch?.id;
    if (!batchId || !destinationReady) return;

    if (activeBatch?.status === "scheduled" && !partial) {
      setResult("Este lote já foi agendado. Inicie um novo upload para programar mais vídeos.");
      return;
    }

    try {
      const contextRes = await apiFetch("/api/schedule/insertion-context", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          platform: uploadPlatform,
          account_id: uploadAccountId,
          upload_batch_id: batchId,
          schedule_mode: effectiveScheduleMode,
          batch_scheduled_count: batchScheduledCount(),
        }),
      });
      const contextData = await readJsonResponse(contextRes);
      if (!contextRes.ok) {
        throw new Error(formatApiError(contextData.error) || "Falha ao analisar calendário");
      }

      const defaultStrategy = String(
        contextData.default_strategy ?? "continue",
      ) as ScheduleInsertionStrategy;
      setScheduleStrategy(defaultStrategy);

      if (contextData.show_strategy_picker) {
        setPendingSchedulePartial(partial);
        setShowStrategyPicker(true);
        return;
      }

      await executeSchedule(partial);
    } catch (error) {
      setResult(error instanceof Error ? error.message : "Erro desconhecido");
    }
  }
  handleScheduleRef.current = handleSchedule;

  const handleSchedulePartial = useCallback(() => {
    void handleScheduleRef.current(true);
  }, []);

  const publicationModes: Array<{
    id: ScheduleMode;
    badge?: string;
    title: string;
    emoji: string;
    description: string;
  }> = [
    {
      id: "auto",
      badge: destinationMode !== "tiktok" ? "Recomendado ⭐" : undefined,
      title: "Automático",
      emoji: "🤖",
      description: AUTO_MODE_SHORT_DESCRIPTION,
    },
    {
      id: "warmup",
      badge: destinationMode === "tiktok" ? "Recomendado ⭐" : "Conta nova",
      title: "Aquecimento",
      emoji: "🛡️",
      description: WARMUP_MODE_SHORT_DESCRIPTION,
    },
    {
      id: "today",
      badge: "Urgente",
      title: "Publicar Hoje",
      emoji: "⚡",
      description: "Todos os vídeos serão publicados ainda hoje.",
    },
    {
      id: "custom",
      title: "Personalizado",
      emoji: "🎯",
      description: "Você define exatamente como deseja publicar.",
    },
  ];

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        handleSchedule(false);
      }}
      className="space-y-6"
    >
      <section className="ig-panel space-y-5 p-5">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-ig-muted">
            Escolher destinos
          </p>
          <div className="mt-3 grid gap-2 sm:grid-cols-3">
            {(
              [
                ["instagram", canUseInstagram],
                ["tiktok", canUseTiktok],
                ["both", canUseInstagram && canUseTiktok],
              ] as const
            ).map(([mode, enabled]) => (
              <button
                key={mode}
                type="button"
                disabled={!enabled}
                onClick={() => setDestinationMode(mode)}
                className={`rounded-xl border px-3 py-3 text-left text-sm transition ${
                  destinationMode === mode
                    ? "border-ig-primary bg-ig-primary/10"
                    : "border-ig-border bg-ig-elevated hover:bg-ig-secondary"
                } ${!enabled ? "cursor-not-allowed opacity-50" : ""}`}
              >
                <p className="font-semibold text-ig-text">{DESTINATION_LABELS[mode]}</p>
                {!enabled && (
                  <p className="mt-1 text-xs text-ig-muted">Conecte a conta primeiro</p>
                )}
              </button>
            ))}
          </div>
        </div>

        {(destinationMode === "instagram" || destinationMode === "both") && canUseInstagram && (
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-ig-muted">
              Conta Instagram
            </p>
            <select
              value={selectedInstagramId}
              onChange={(event) => setSelectedInstagramId(event.target.value)}
              className="mt-2 w-full rounded-xl border border-ig-border bg-ig-secondary px-4 py-3 text-sm"
            >
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  @{account.ig_username ?? "conta"}
                </option>
              ))}
            </select>
          </div>
        )}

        {(destinationMode === "tiktok" || destinationMode === "both") && canUseTiktok && (
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-ig-muted">
              Conta TikTok
            </p>
            <select
              value={selectedTiktokId}
              onChange={(event) => setSelectedTiktokId(event.target.value)}
              className="mt-2 w-full rounded-xl border border-ig-border bg-ig-secondary px-4 py-3 text-sm"
            >
              {tiktokAccounts.map((account) => (
                <option key={account.id} value={account.id}>
                  @{account.username ?? account.display_name ?? "conta"}
                </option>
              ))}
            </select>
          </div>
        )}

        {destinationMode === "instagram" && (
          <div className="flex items-center gap-3 rounded-xl border border-ig-border bg-ig-secondary px-4 py-3">
            {selectedAvatar ? (
              <img src={selectedAvatar} alt="" className="h-10 w-10 rounded-full object-cover" />
            ) : (
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-ig-elevated text-ig-muted">
                <UserRound size={18} />
              </div>
            )}
            <p className="truncate font-semibold text-ig-text">@{selectedUsername}</p>
          </div>
        )}

        <ProductCampaignSelector value={campaignSelection} onChange={setCampaignSelection} />

        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-ig-muted">Upload</p>
          <p className="mt-1 text-sm text-ig-muted">
            Envie todos os seus vídeos de uma vez. A plataforma envia, organiza, cria legendas e agenda automaticamente.
          </p>
          <div className="mt-3">
            <SupremeUploadManager
              accountId={uploadAccountId}
              accountLabel={selectedUsername}
              platform={uploadPlatform}
              scheduleMode={scheduleMode}
              customSchedule={customSchedulePayload}
              onBatchUpdate={handleBatchUpdate}
              onUploadingChange={handleUploadingChange}
              onSchedulePartial={handleSchedulePartial}
            />
          </div>

          {totalCount > 0 && (
            <div className="mt-4 rounded-xl border border-ig-info-border bg-ig-info-bg px-4 py-3 text-sm">
              <p className="font-semibold text-ig-text">
                {uploadView?.headlineText ?? `${completedCount} de ${totalCount} vídeos enviados`}
              </p>
              {uploadView && (
                <p className="mt-1 text-ig-muted">{uploadView.statusCounterText}</p>
              )}
              {uploadView?.bytesSummaryText && uploadView.bytesSummaryText !== "—" && (
                <p className="mt-1 text-ig-muted">{uploadView.bytesSummaryText}</p>
              )}
              {durationPreview.days && <p className="mt-1 text-ig-muted">{durationPreview.days}</p>}
            </div>
          )}
        </div>
      </section>

      <section className="ig-panel p-5">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-ig-primary">
          O que a IA vai fazer
        </h2>
        <ul className="space-y-2">
          {AI_TASKS.map((task) => (
            <li key={task} className="flex items-center gap-2 text-sm text-ig-text">
              <Check size={16} className="text-ig-primary" />
              {task}
            </li>
          ))}
        </ul>
      </section>

      <section className="ig-panel space-y-3 p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ig-primary">
          Modo de publicação
        </h2>
        <div className="space-y-3">
          {publicationModes.map((mode) => {
            const selected = scheduleMode === mode.id;
            return (
              <button
                key={mode.id}
                type="button"
                onClick={() => void changeScheduleMode(mode.id)}
                className={`w-full rounded-2xl border px-4 py-4 text-left transition ${
                  selected
                    ? "border-ig-primary bg-ig-primary/10"
                    : "border-ig-border bg-ig-elevated hover:bg-ig-secondary"
                }`}
              >
                <div className="flex items-start gap-3">
                  <span className="mt-0.5 text-sm text-ig-primary">{selected ? "●" : "○"}</span>
                  <div className="min-w-0 flex-1">
                    {mode.badge && (
                      <p className="text-xs font-medium text-ig-primary">{mode.badge}</p>
                    )}
                    <p className="mt-1 text-base font-semibold text-ig-text">
                      {mode.emoji} {mode.title}
                    </p>
                    <p className="mt-1 text-sm text-ig-muted">{mode.description}</p>
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        {scheduleMode === "auto" && (
          <div className="space-y-3 rounded-2xl border border-ig-border bg-ig-secondary p-4">
            <p className="text-sm font-medium text-ig-text">Perfil da conta</p>
            <p className="text-xs text-ig-muted">
              Define quantos posts por dia e a distribuição de horários no modo automático.
            </p>
            <div className="grid gap-2 sm:grid-cols-3">
              {(["new", "growing", "strong"] as AutoAccountProfile[]).map((profile) => {
                const selected = autoProfile === profile;
                return (
                  <button
                    key={profile}
                    type="button"
                    onClick={() => setAutoProfile(profile)}
                    className={`rounded-xl border px-3 py-3 text-left text-sm transition ${
                      selected
                        ? "border-ig-primary bg-ig-primary/10"
                        : "border-ig-border bg-ig-elevated hover:bg-ig-secondary"
                    }`}
                  >
                    <p className="font-semibold text-ig-text">{AUTO_PROFILE_LABELS[profile]}</p>
                    <p className="mt-1 text-xs text-ig-muted">{AUTO_PROFILE_DESCRIPTIONS[profile]}</p>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {scheduleMode === "warmup" && <WarmupScheduleOverview />}

        {scheduleMode === "custom" && (
          <div className="space-y-4 rounded-2xl border border-ig-border bg-ig-secondary p-4">
            <div>
              <label className="mb-2 block text-sm font-medium text-ig-text">Posts por dia</label>
              <input
                type="number"
                min={1}
                max={100}
                value={customPostsPerDay}
                onChange={(event) => setCustomPostsPerDay(Number(event.target.value))}
                onBlur={(event) => void changeCustomPostsPerDay(Number(event.target.value))}
                className="ig-input w-full max-w-[120px] text-center text-lg font-semibold"
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-2 block text-sm font-medium text-ig-text">Início (Brasília)</label>
                <input
                  type="time"
                  value={customStartTime}
                  onChange={(event) => setCustomStartTime(event.target.value)}
                  onBlur={(event) => void changeCustomTimeRange(event.target.value, customEndTime)}
                  className="ig-input w-full"
                />
              </div>
              <div>
                <label className="mb-2 block text-sm font-medium text-ig-text">Fim (Brasília)</label>
                <input
                  type="time"
                  value={customEndTime}
                  onChange={(event) => setCustomEndTime(event.target.value)}
                  onBlur={(event) => void changeCustomTimeRange(customStartTime, event.target.value)}
                  className="ig-input w-full"
                />
              </div>
            </div>
            <p className="text-xs text-ig-muted">
              {customPostsPerDay} horários distribuídos entre {customStartTime} e {customEndTime} (horário de Brasília).
            </p>
            <div>
              <label className="mb-2 block text-sm font-medium text-ig-text">Horários gerados</label>
              <div className="flex flex-wrap gap-2">
                {customTimeSlots.map((time) => (
                  <button
                    key={time}
                    type="button"
                    onClick={() => {
                      if (customTimeSlots.length <= 1) return;
                      void changeCustomTimeSlots(customTimeSlots.filter((item) => item !== time));
                    }}
                    className="inline-flex items-center gap-1 rounded-full border border-ig-border bg-ig-elevated px-3 py-1.5 text-sm font-medium text-ig-text"
                  >
                    {time}
                    {customTimeSlots.length > 1 && <X size={12} className="text-ig-muted" />}
                  </button>
                ))}
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <input
                  type="text"
                  value={newTimeInput}
                  onChange={(event) => setNewTimeInput(event.target.value)}
                  placeholder="HH:mm"
                  className="ig-input w-24"
                />
                <button
                  type="button"
                  onClick={addCustomTime}
                  className="ig-btn-secondary inline-flex items-center gap-2 px-3 py-2 text-sm"
                >
                  <Plus size={14} />
                  Adicionar horário
                </button>
              </div>
            </div>
          </div>
        )}
      </section>

      {totalCount > 0 && (
        <section className="ig-panel p-5">
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-ig-primary">
            Resumo
          </h2>
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-ig-muted">Destinos</dt>
              <dd className="font-medium text-ig-text">{DESTINATION_LABELS[destinationMode]}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-ig-muted">Conta</dt>
              <dd className="font-medium text-ig-text">
                {destinationMode === "both"
                  ? `@${accounts.find((a) => a.id === selectedInstagramId)?.ig_username ?? "ig"} + @${tiktokAccounts.find((a) => a.id === selectedTiktokId)?.username ?? "tt"}`
                  : `@${selectedUsername}`}
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-ig-muted">Vídeos</dt>
              <dd className="font-medium text-ig-text">
                {completedCount}/{totalCount}
                {failedCount > 0 ? ` (${failedCount} falharam)` : ""}
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-ig-muted">Modo</dt>
              <dd className="font-medium text-ig-text">{modeLabel(effectiveScheduleMode)}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-ig-muted">Previsão</dt>
              <dd className="text-right font-medium text-ig-text">
                {durationPreview.summary || "—"}
              </dd>
            </div>
          </dl>
        </section>
      )}

      {captionSource === "fallback" && (
        <div className="rounded-xl border border-ig-info-border bg-ig-info-bg px-4 py-3 text-sm text-ig-muted">
          A IA de legendas está indisponível. Foram usadas legendas automáticas genéricas — configure{" "}
          <strong className="text-ig-text">OPENAI_API_KEY</strong> ou ajuste o playbook para melhorar.
        </div>
      )}

      {canSchedulePartial && (
        <button
          type="button"
          disabled={scheduling || isUploading || !destinationReady}
          onClick={() => handleSchedule(true)}
          className="ig-btn-secondary w-full py-3 text-sm font-semibold disabled:opacity-50"
        >
          Agendar {completedCount} vídeo(s) enviados agora
        </button>
      )}

      <button
        type="submit"
        disabled={scheduling || isUploading || !canScheduleAll || !destinationReady}
        className="ig-btn w-full py-4 text-base font-bold disabled:opacity-50"
      >
        {scheduling
          ? loadingStep || "Processando..."
          : isUploading
            ? "Aguardando upload..."
            : canScheduleAll
              ? "🚀 DEIXAR A IA PROGRAMAR TUDO"
              : "Aguardando vídeos para agendar"}
      </button>

      {!canScheduleAll && completedCount === 0 && totalCount > 0 && (
        <p className="text-center text-sm text-ig-muted">
          Continue o upload para agendar. Os vídeos enviados ficam salvos no lote.
        </p>
      )}

      {scheduleJobNotice && (
        <div className="rounded-xl border border-ig-info-border bg-ig-info-bg px-4 py-3 text-sm text-ig-muted">
          {scheduleJobNotice}
        </div>
      )}

      {scheduleJobId && (
        <ScheduleJobPanel
          jobId={scheduleJobId}
          videoCount={completedCount || totalCount}
          initialStatus={scheduleJobInitialStatus}
          onComplete={handleScheduleJobComplete}
          onBatchRefresh={() => void refreshActiveBatch()}
        />
      )}

      {(scheduling || completedSteps.length > 0) && !scheduleJobId && (
        <section className="ig-panel space-y-2 p-5">
          {PROGRESS_STEPS.map((step) => {
            const done = completedSteps.includes(step.id);
            return (
              <p key={step.id} className={`flex items-center gap-2 text-sm ${done ? "text-ig-text" : "text-ig-muted"}`}>
                {done ? <Check size={16} className="text-ig-primary" /> : <span className="w-4" />}
                {done ? "✓ " : ""}
                {step.label(completedCount)}
              </p>
            );
          })}
        </section>
      )}

      {scheduling && progress > 0 && !scheduleJobId && (
        <div className="h-2 overflow-hidden rounded-full bg-ig-secondary">
          <div
            className="h-full rounded-full bg-ig-primary transition-all duration-300"
            style={{ width: `${progress}%` }}
          />
        </div>
      )}

      {result && !scheduleJobId && (
        <p className={`text-sm ${result.includes("agendad") ? "text-ig-text" : "text-ig-danger"}`}>
          {result.includes("agendad") ? "✓ " : ""}
          {result}
        </p>
      )}

      {showStrategyPicker && (
        <ScheduleStrategyPicker
          value={scheduleStrategy}
          onChange={setScheduleStrategy}
          loading={scheduling}
          onCancel={() => {
            setShowStrategyPicker(false);
            setPendingSchedulePartial(false);
          }}
          onConfirm={async () => {
            setShowStrategyPicker(false);
            await executeSchedule(pendingSchedulePartial);
            setPendingSchedulePartial(false);
          }}
        />
      )}

      {previewVideos && (
        <MultiplatformPreview
          videos={previewVideos}
          scheduleSummary={previewSummary}
          captionSource={captionSource ?? "ai"}
          totalPosts={previewTotalPosts}
          loading={confirmingPreview}
          onCaptionChange={handlePreviewCaptionChange}
          warmupBreakdown={previewWarmupBreakdown}
          insertionPreview={insertionPreview}
          accountLabel={selectedUsername}
          modeLabel={modeLabel(effectiveScheduleMode)}
          onCancel={() => {
            setPreviewVideos(null);
            setPreviewItems([]);
            setPreviewWarmupBreakdown(null);
            setInsertionPreview(null);
          }}
          onConfirm={async () => {
            try {
              const { created, skippedVideos } = await confirmMultiplatformPreview();
              setPreviewVideos(null);
              setPreviewWarmupBreakdown(null);
              setInsertionPreview(null);
              const destLabel =
                destinationMode === "both"
                  ? "em múltiplas plataformas"
                  : destinationMode === "tiktok"
                    ? "no TikTok"
                    : "no Instagram";
              const skippedNote =
                skippedVideos > 0 ? ` ${skippedVideos} vídeo(s) ignorados por erro.` : "";
              setResult(`${created} publicações agendadas ${destLabel}.${skippedNote} ${previewSummary}`);
              window.setTimeout(() => {
                const query = new URLSearchParams({
                  platform: uploadPlatform,
                  account:
                    uploadPlatform === "tiktok" ? selectedTiktokId : selectedInstagramId,
                });
                window.location.href =
                  uploadPlatform === "tiktok"
                    ? `/dashboard/tiktok?${query.toString()}`
                    : `/dashboard/reports?${query.toString()}`;
              }, 1200);
            } catch (error) {
              setResult(error instanceof Error ? error.message : "Erro ao confirmar");
            }
          }}
        />
      )}
    </form>
  );
}
