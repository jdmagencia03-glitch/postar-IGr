"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Loader2, Plus, UserRound, X } from "lucide-react";
import { getCompletedUploadItems, SupremeUploadManager } from "@/components/upload/SupremeUploadManager";
import { updateBatchSchedule } from "@/lib/upload/client";
import { API_BATCH_SIZE } from "@/lib/autopilot-constants";
import { DEFAULT_WARMUP_DAYS } from "@/lib/account-warmup";
import { estimateScheduleDuration, parseTimeSlot, parseTimeSlots } from "@/lib/smart-schedule";
import type { InstagramAccount, UploadBatch } from "@/lib/types";

interface Props {
  accounts: InstagramAccount[];
  defaultAccountId?: string;
}

type ScheduleMode = "auto" | "warmup" | "today" | "custom";

const SCHEDULE_DRAFT_KEY = "postarigr-bulk-schedule-draft";

const DEFAULT_CUSTOM_TIMES = [
  "06:00",
  "08:00",
  "10:00",
  "12:00",
  "14:00",
  "16:00",
  "18:00",
  "20:00",
];

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
  customTimeSlots: string[] = DEFAULT_CUSTOM_TIMES,
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

function readScheduleDraft(accountId: string) {
  if (typeof window === "undefined" || !accountId) return null;
  try {
    const raw = sessionStorage.getItem(`${SCHEDULE_DRAFT_KEY}:${accountId}`);
    if (!raw) return null;
    return JSON.parse(raw) as {
      scheduleMode: ScheduleMode;
      customPostsPerDay: number;
      customTimeSlots: string[];
    };
  } catch {
    return null;
  }
}

function writeScheduleDraft(
  accountId: string,
  draft: { scheduleMode: ScheduleMode; customPostsPerDay: number; customTimeSlots: string[] },
) {
  if (typeof window === "undefined" || !accountId) return;
  sessionStorage.setItem(`${SCHEDULE_DRAFT_KEY}:${accountId}`, JSON.stringify(draft));
}

function applyBatchSchedule(batch: UploadBatch) {
  const nextMode = batch.schedule_mode;
  const nextPosts = batch.custom_schedule?.posts_per_day ?? 15;
  const nextSlots =
    batch.custom_schedule?.time_slots?.length ? batch.custom_schedule.time_slots : DEFAULT_CUSTOM_TIMES;
  return { scheduleMode: nextMode, customPostsPerDay: nextPosts, customTimeSlots: nextSlots };
}

function batchSummaryEqual(a: UploadBatch | null, b: UploadBatch | null) {
  if (a === b) return true;
  if (!a || !b) return false;
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

export function BulkUploadForm({ accounts, defaultAccountId }: Props) {
  const initialAccountId = useMemo(() => {
    if (defaultAccountId && accounts.some((account) => account.id === defaultAccountId)) {
      return defaultAccountId;
    }
    return accounts[0]?.id ?? "";
  }, [accounts, defaultAccountId]);

  const draft = useMemo(() => readScheduleDraft(initialAccountId), [initialAccountId]);

  const [scheduleMode, setScheduleMode] = useState<ScheduleMode>(draft?.scheduleMode ?? "auto");
  const [customPostsPerDay, setCustomPostsPerDay] = useState(draft?.customPostsPerDay ?? 15);
  const [customTimeSlots, setCustomTimeSlots] = useState<string[]>(draft?.customTimeSlots ?? DEFAULT_CUSTOM_TIMES);
  const [newTimeInput, setNewTimeInput] = useState("");
  const [selectedAccountId, setSelectedAccountId] = useState(initialAccountId);
  const [activeBatch, setActiveBatch] = useState<UploadBatch | null>(null);
  const restoredBatchIdRef = useRef<string | null>(null);
  const handleScheduleRef = useRef<(partial?: boolean) => Promise<void>>(async () => {});
  const [isUploading, setIsUploading] = useState(false);
  const [scheduling, setScheduling] = useState(false);
  const [loadingStep, setLoadingStep] = useState("");
  const [progress, setProgress] = useState(0);
  const [completedSteps, setCompletedSteps] = useState<string[]>([]);
  const [result, setResult] = useState<string | null>(null);

  const selectedAccount = accounts.find((account) => account.id === selectedAccountId) ?? accounts[0];
  const completedCount = activeBatch?.completed_files ?? 0;
  const totalCount = activeBatch?.total_files ?? 0;
  const warmupDays = selectedAccount?.warmup_days ?? DEFAULT_WARMUP_DAYS;
  const batchReady = activeBatch?.status === "ready";
  const canSchedulePartial = completedCount > 0 && !batchReady;
  const canScheduleAll = batchReady && completedCount > 0;

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
  );

  const customSchedulePayload = useMemo(
    () =>
      scheduleMode === "custom"
        ? { posts_per_day: customPostsPerDay, time_slots: customTimeSlots }
        : null,
    [scheduleMode, customPostsPerDay, customTimeSlots],
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
    setCustomTimeSlots(restored.customTimeSlots);
    writeScheduleDraft(selectedAccountId, restored);
  }, [activeBatch, selectedAccountId]);

  useEffect(() => {
    writeScheduleDraft(selectedAccountId, { scheduleMode, customPostsPerDay, customTimeSlots });
  }, [selectedAccountId, scheduleMode, customPostsPerDay, customTimeSlots]);

  async function persistSchedule(
    mode: ScheduleMode,
    postsPerDay: number,
    timeSlots: string[],
  ) {
    if (!activeBatch) return;
    try {
      const updated = await updateBatchSchedule(activeBatch.id, {
        schedule_mode: mode,
        custom_schedule:
          mode === "custom"
            ? { posts_per_day: postsPerDay, time_slots: timeSlots }
            : null,
      });
      setActiveBatch((prev) => (batchSummaryEqual(prev, updated) ? prev : updated));
    } catch (error) {
      setResult(error instanceof Error ? error.message : "Falha ao salvar modo de publicação");
    }
  }

  async function changeScheduleMode(mode: ScheduleMode) {
    setScheduleMode(mode);
    await persistSchedule(mode, customPostsPerDay, customTimeSlots);
  }

  async function changeCustomPostsPerDay(value: number) {
    setCustomPostsPerDay(value);
    if (scheduleMode === "custom") {
      await persistSchedule("custom", value, customTimeSlots);
    }
  }

  async function changeCustomTimeSlots(next: string[]) {
    setCustomTimeSlots(next);
    if (scheduleMode === "custom") {
      await persistSchedule("custom", customPostsPerDay, next);
    }
  }

  function markStep(stepId: string) {
    setCompletedSteps((current) => (current.includes(stepId) ? current : [...current, stepId]));
  }

  function buildSchedulePayload(mode = effectiveScheduleMode) {
    if (mode !== "custom") return {};
    return {
      custom_schedule: {
        posts_per_day: effectiveCustomPostsPerDay,
        time_slots: effectiveCustomTimeSlots,
      },
    };
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

  async function confirmAutopilotBatch(params: {
    items: Array<{ media_urls: string[]; filename: string }>;
    captions: string[];
    schedule: string[];
  }) {
    const autopilotRes = await apiFetch("/api/posts/autopilot", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        account_ids: [selectedAccountId],
        schedule_mode: effectiveScheduleMode,
        items: params.items,
        captions: params.captions,
        schedule: params.schedule,
        ...buildSchedulePayload(),
      }),
    });
    const autopilotData = await readJsonResponse(autopilotRes);
    if (!autopilotRes.ok) {
      throw new Error(String(autopilotData.error ?? "Falha ao confirmar agendamento"));
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
          account_ids: [selectedAccountId],
          schedule_mode: effectiveScheduleMode,
          items: batchItems,
          batch_offset: offset,
          total_count: total,
          ...buildSchedulePayload(),
        }),
      });

      const previewData = await readJsonResponse(previewRes);
      if (!previewRes.ok) {
        throw new Error(String(previewData.error ?? "Falha ao gerar plano IA"));
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

  async function handleSchedule(partial = false) {
    if (!activeBatch || !selectedAccountId) return;

    const items = getCompletedUploadItems(activeBatch);
    if (!items.length) {
      setResult("Envie pelo menos um vídeo antes de agendar.");
      return;
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
    setProgress(0);
    setCompletedSteps([]);
    markStep("videos");

    try {
      const { totalCreated, lastScheduleSummary } = await runAutopilot(items);
      setResult(
        partial
          ? `${totalCreated} publicações agendadas agora. Continue enviando o restante depois. ${lastScheduleSummary}`
          : `${totalCreated} publicações agendadas. ${lastScheduleSummary}`,
      );
    } catch (error) {
      setResult(error instanceof Error ? error.message : "Erro desconhecido");
    } finally {
      setScheduling(false);
      setLoadingStep("");
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
      badge: "Recomendado ⭐",
      title: "Automático",
      emoji: "🤖",
      description:
        "A IA escolhe quantos posts por dia, os melhores horários e a distribuição no calendário.",
    },
    {
      id: "warmup",
      badge: "Conta nova",
      title: "Aquecimento",
      emoji: "🛡️",
      description: "Ideal para contas recém-criadas. Começa devagar e aumenta gradualmente.",
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
          <p className="text-xs font-semibold uppercase tracking-wide text-ig-muted">Conta</p>
          <p className="mt-1 text-sm text-ig-text">Instagram conectado</p>
          <div className="mt-3 flex items-center gap-3 rounded-xl border border-ig-border bg-ig-secondary px-4 py-3">
            {selectedAccount?.profile_picture_url ? (
              <img
                src={selectedAccount.profile_picture_url}
                alt=""
                className="h-10 w-10 rounded-full object-cover"
              />
            ) : (
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-ig-elevated text-ig-muted">
                <UserRound size={18} />
              </div>
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate font-semibold text-ig-text">
                @{selectedAccount?.ig_username ?? "conta"}
              </p>
              {accounts.length > 1 && (
                <div className="relative mt-1">
                  <select
                    value={selectedAccountId}
                    onChange={(event) => setSelectedAccountId(event.target.value)}
                    className="w-full appearance-none rounded-lg border border-ig-border bg-ig-elevated py-1.5 pl-2 pr-8 text-xs text-ig-text"
                  >
                    {accounts.map((account) => (
                      <option key={account.id} value={account.id}>
                        @{account.ig_username}
                      </option>
                    ))}
                  </select>
                  <ChevronDown
                    size={14}
                    className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-ig-muted"
                  />
                </div>
              )}
            </div>
          </div>
        </div>

        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-ig-muted">Upload</p>
          <p className="mt-1 text-sm text-ig-muted">
            Envie todos os seus vídeos de uma vez. A plataforma envia, organiza, cria legendas e agenda automaticamente.
          </p>
          <div className="mt-3">
            <SupremeUploadManager
              accountId={selectedAccountId}
              scheduleMode={scheduleMode}
              customSchedule={customSchedulePayload}
              onBatchUpdate={handleBatchUpdate}
              onUploadingChange={handleUploadingChange}
              onSchedulePartial={handleSchedulePartial}
            />
          </div>

          {totalCount > 0 && (
            <div className="mt-4 rounded-xl border border-ig-info-border bg-ig-info-bg px-4 py-3 text-sm">
              <p className="font-semibold text-ig-text">{completedCount} de {totalCount} vídeos enviados</p>
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
            <div>
              <label className="mb-2 block text-sm font-medium text-ig-text">Horários</label>
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
              <dt className="text-ig-muted">Conta</dt>
              <dd className="font-medium text-ig-text">@{selectedAccount?.ig_username ?? "—"}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-ig-muted">Vídeos</dt>
              <dd className="font-medium text-ig-text">
                {completedCount}/{totalCount}
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

      {canSchedulePartial && (
        <button
          type="button"
          disabled={scheduling || isUploading}
          onClick={() => handleSchedule(true)}
          className="ig-btn-secondary w-full py-3 text-sm font-semibold disabled:opacity-50"
        >
          Agendar {completedCount} vídeo(s) enviados agora
        </button>
      )}

      <button
        type="submit"
        disabled={scheduling || isUploading || !canScheduleAll}
        className="ig-btn w-full py-4 text-base font-bold disabled:opacity-50"
      >
        {scheduling
          ? loadingStep || "Processando..."
          : canScheduleAll
            ? "🚀 DEIXAR A IA PROGRAMAR TUDO"
            : "🚀 DEIXAR A IA PROGRAMAR TUDO"}
      </button>

      {!canScheduleAll && completedCount === 0 && totalCount > 0 && (
        <p className="text-center text-sm text-ig-muted">
          Continue o upload para agendar. Os vídeos enviados ficam salvos no lote.
        </p>
      )}

      {(scheduling || completedSteps.length > 0) && (
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

      {scheduling && progress > 0 && (
        <div className="h-2 overflow-hidden rounded-full bg-ig-secondary">
          <div
            className="h-full rounded-full bg-ig-primary transition-all duration-300"
            style={{ width: `${progress}%` }}
          />
        </div>
      )}

      {result && (
        <p className={`text-sm ${result.includes("agendad") ? "text-ig-text" : "text-ig-danger"}`}>
          {result.includes("agendad") ? "✓ " : ""}
          {result}
        </p>
      )}
    </form>
  );
}
