"use client";

import { useMemo, useState } from "react";
import { Calendar, Sparkles, Settings2, Zap, Flame, ShieldAlert } from "lucide-react";
import { AutopilotPreview, type PreviewEntry } from "@/components/AutopilotPreview";
import { OnboardingSteps } from "@/components/OnboardingSteps";
import {
  API_BATCH_SIZE,
  MAX_PREVIEW_VIDEOS,
  MAX_VIDEOS_TOTAL,
  UPLOAD_BATCH_SIZE,
} from "@/lib/autopilot-constants";
import {
  assessPostingRisk,
  DEFAULT_WARMUP_DAYS,
  describeWarmupPlan,
} from "@/lib/account-warmup";
import { estimateScheduleDuration } from "@/lib/smart-schedule";
import type { InstagramAccount } from "@/lib/types";

interface Props {
  accounts: InstagramAccount[];
  defaultAccountId?: string;
  playbookReady?: boolean;
}

type UploadMode = "autopilot" | "manual";
type ScheduleMode = "auto" | "today" | "warmup";

async function apiFetch(input: RequestInfo | URL, init?: RequestInit) {
  const response = await fetch(input, {
    ...init,
    credentials: "include",
  });

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
    if (text.includes("Request Entity Too Large")) {
      throw new Error("Vídeo muito grande para enviar pelo servidor. Tente novamente.");
    }
    throw new Error(text.slice(0, 120) || "Resposta inválida do servidor");
  }
}

function parseHours(value: string) {
  return value
    .split(",")
    .map((part) => {
      const trimmed = part.trim();
      const match = trimmed.match(/^(\d{1,2})/);
      return match ? parseInt(match[1], 10) : NaN;
    })
    .filter((hour) => !Number.isNaN(hour) && hour >= 0 && hour <= 23);
}

function chunkArray<T>(items: T[], size: number) {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

export function BulkUploadForm({ accounts, defaultAccountId, playbookReady = false }: Props) {
  const initialSelection = useMemo(() => {
    if (defaultAccountId && accounts.some((a) => a.id === defaultAccountId)) {
      return [defaultAccountId];
    }
    return accounts[0]?.id ? [accounts[0].id] : [];
  }, [accounts, defaultAccountId]);

  const [mode, setMode] = useState<UploadMode>("autopilot");
  const [scheduleMode, setScheduleMode] = useState<ScheduleMode>("warmup");
  const [oneClickMode, setOneClickMode] = useState(true);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [files, setFiles] = useState<FileList | null>(null);
  const [selectedAccountIds, setSelectedAccountIds] = useState<string[]>(initialSelection);
  const [startDate, setStartDate] = useState("");
  const [postsPerDay, setPostsPerDay] = useState(1);
  const [hours, setHours] = useState("9");
  const [captionTemplate, setCaptionTemplate] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadingStep, setLoadingStep] = useState("");
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<string | null>(null);

  const [showPreview, setShowPreview] = useState(false);
  const [previewEntries, setPreviewEntries] = useState<PreviewEntry[]>([]);
  const [previewSchedule, setPreviewSchedule] = useState<string[]>([]);
  const [previewAccounts, setPreviewAccounts] = useState<Array<{ ig_username: string | null }>>([]);
  const [previewCaptionSource, setPreviewCaptionSource] = useState<"ai" | "fallback">("fallback");
  const [previewScheduleSummary, setPreviewScheduleSummary] = useState("");
  const [previewDurationLabel, setPreviewDurationLabel] = useState("");
  const [previewTotalPosts, setPreviewTotalPosts] = useState(0);
  const [pendingItems, setPendingItems] = useState<Array<{ media_urls: string[]; filename: string }>>(
    [],
  );
  const [confirming, setConfirming] = useState(false);

  const allSelected = selectedAccountIds.length === accounts.length && accounts.length > 0;
  const videoCount = files?.length ?? 0;
  const totalPosts = videoCount * selectedAccountIds.length;

  const selectedAccounts = useMemo(
    () => accounts.filter((a) => selectedAccountIds.includes(a.id)),
    [accounts, selectedAccountIds],
  );

  const hasWarmupAccounts = selectedAccounts.some((a) => a.warmup_enabled !== false);

  const postingRisk = useMemo(() => {
    if (!videoCount || mode !== "autopilot") return null;
    return assessPostingRisk({
      scheduleMode,
      videoCount,
      accounts: selectedAccounts,
    });
  }, [videoCount, scheduleMode, mode, selectedAccounts]);

  const scheduleEstimate = useMemo(() => {
    if (!videoCount || mode !== "autopilot") return null;
    const warmupDays = selectedAccounts[0]?.warmup_days ?? DEFAULT_WARMUP_DAYS;
    return estimateScheduleDuration(videoCount, scheduleMode, warmupDays);
  }, [videoCount, scheduleMode, mode, selectedAccounts]);

  const canUsePreview = videoCount > 0 && videoCount <= MAX_PREVIEW_VIDEOS && !oneClickMode;
  const batchCount = videoCount > 0 ? Math.ceil(videoCount / API_BATCH_SIZE) : 0;

  function toggleAccount(accountId: string) {
    setSelectedAccountIds((current) =>
      current.includes(accountId)
        ? current.filter((id) => id !== accountId)
        : [...current, accountId],
    );
  }

  function toggleAllAccounts() {
    if (allSelected) {
      setSelectedAccountIds(accounts[0]?.id ? [accounts[0].id] : []);
      return;
    }
    setSelectedAccountIds(accounts.map((a) => a.id));
  }

  async function uploadFileBatch(fileArray: File[]) {
    const prepareRes = await apiFetch("/api/upload/prepare", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        files: fileArray.map((file) => ({
          name: file.name,
          type: file.type,
          size: file.size,
        })),
      }),
    });

    const prepareData = await readJsonResponse(prepareRes);
    if (!prepareRes.ok) {
      throw new Error(String(prepareData.error ?? "Falha ao preparar upload"));
    }

    const uploads = prepareData.uploads as Array<{
      signedUrl: string;
      publicUrl: string;
      contentType: string;
      name: string;
    }>;

    const items: Array<{ media_urls: string[]; filename: string }> = [];

    for (let i = 0; i < fileArray.length; i++) {
      const file = fileArray[i];
      const target = uploads[i];
      const uploadRes = await fetch(target.signedUrl, {
        method: "PUT",
        headers: {
          "Content-Type": target.contentType,
          "x-upsert": "false",
        },
        body: file,
      });

      if (!uploadRes.ok) {
        throw new Error(`Falha ao enviar ${target.name}`);
      }

      items.push({
        media_urls: [target.publicUrl],
        filename: file.name,
      });
    }

    return items;
  }

  async function uploadFiles(fileArray: File[]) {
    const allItems: Array<{ media_urls: string[]; filename: string }> = [];
    const batches = chunkArray(fileArray, UPLOAD_BATCH_SIZE);

    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];
      const start = i * UPLOAD_BATCH_SIZE + 1;
      const end = Math.min((i + 1) * UPLOAD_BATCH_SIZE, fileArray.length);
      setLoadingStep(`Enviando vídeos ${start}-${end} de ${fileArray.length}...`);
      setProgress(Math.round((i / batches.length) * 30));
      const items = await uploadFileBatch(batch);
      allItems.push(...items);
    }

    return allItems;
  }

  function closePreview() {
    setShowPreview(false);
    setPreviewEntries([]);
    setPreviewSchedule([]);
    setPreviewAccounts([]);
    setPendingItems([]);
    setConfirming(false);
  }

  function handleCaptionChange(index: number, caption: string) {
    setPreviewEntries((current) =>
      current.map((entry) => (entry.index === index ? { ...entry, caption } : entry)),
    );
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
        account_ids: selectedAccountIds,
        schedule_mode: scheduleMode,
        items: params.items,
        captions: params.captions,
        schedule: params.schedule,
      }),
    });

    const autopilotData = await readJsonResponse(autopilotRes);
    if (!autopilotRes.ok) {
      throw new Error(String(autopilotData.error ?? "Falha ao confirmar agendamento"));
    }

    return Number(autopilotData.created ?? 0);
  }

  async function handleConfirmPreview() {
    if (!pendingItems.length || !previewEntries.length) return;

    setConfirming(true);
    setResult(null);

    try {
      const created = await confirmAutopilotBatch({
        items: pendingItems,
        captions: previewEntries.map((entry) => entry.caption),
        schedule: previewSchedule,
      });

      closePreview();
      setResult(`${created} Reels agendados! ${previewScheduleSummary}`);
    } catch (err) {
      setResult(err instanceof Error ? err.message : "Erro desconhecido");
    } finally {
      setConfirming(false);
      setLoading(false);
      setLoadingStep("");
      setProgress(0);
    }
  }

  async function runAutopilot(items: Array<{ media_urls: string[]; filename: string }>) {
    const total = items.length;
    const batches = chunkArray(items, API_BATCH_SIZE);
    let totalCreated = 0;
    let lastScheduleSummary = "";
    let lastDurationLabel = "";
    let captionSource: "ai" | "fallback" = "fallback";

    for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
      const batchItems = batches[batchIndex];
      const offset = batchIndex * API_BATCH_SIZE;
      const start = offset + 1;
      const end = Math.min(offset + batchItems.length, total);

      setLoadingStep(
        batches.length > 1
          ? `IA processando lote ${batchIndex + 1}/${batches.length} (vídeos ${start}-${end})...`
          : "IA gerando legendas, hashtags e horários...",
      );
      setProgress(30 + Math.round(((batchIndex + 0.5) / batches.length) * 50));

      const previewRes = await apiFetch("/api/posts/autopilot/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          account_ids: selectedAccountIds,
          schedule_mode: scheduleMode,
          items: batchItems,
          batch_offset: offset,
          total_count: total,
        }),
      });

      const previewData = await readJsonResponse(previewRes);
      if (!previewRes.ok) {
        throw new Error(String(previewData.error ?? "Falha ao gerar plano IA"));
      }

      const entries = (previewData.preview as PreviewEntry[]) ?? [];
      const schedule = (previewData.schedule as string[]) ?? [];
      lastScheduleSummary = String(previewData.schedule_summary ?? "");
      lastDurationLabel = String(
        (previewData.duration as { label?: string } | undefined)?.label ?? "",
      );
      captionSource = previewData.caption_source === "ai" ? "ai" : "fallback";

      if (canUsePreview && batchIndex === 0) {
        setPendingItems(batchItems);
        setPreviewEntries(entries);
        setPreviewSchedule(schedule);
        setPreviewAccounts(
          (previewData.accounts as Array<{ ig_username: string | null }>) ??
            selectedAccountIds.map((id) => ({
              ig_username: accounts.find((a) => a.id === id)?.ig_username ?? null,
            })),
        );
        setPreviewCaptionSource(captionSource);
        setPreviewScheduleSummary(lastScheduleSummary);
        setPreviewDurationLabel(lastDurationLabel);
        setPreviewTotalPosts(total * selectedAccountIds.length);
        setShowPreview(true);
        return;
      }

      setLoadingStep(`Agendando lote ${batchIndex + 1}/${batches.length}...`);
      setProgress(80 + Math.round((batchIndex / batches.length) * 15));

      const created = await confirmAutopilotBatch({
        items: batchItems,
        captions: entries.map((entry) => entry.caption),
        schedule,
      });
      totalCreated += created;
    }

    const accountCount = selectedAccountIds.length;
    const sourceLabel = captionSource === "ai" ? "GPT" : "automáticas";
    setResult(
      `${totalCreated} Reels agendados! (${total} vídeo(s) × ${accountCount} conta(s)). ` +
        `Legendas ${sourceLabel}. ${lastDurationLabel || lastScheduleSummary}.`,
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!files?.length || !selectedAccountIds.length) return;
    if (mode === "manual" && !startDate) return;

    if (files.length > MAX_VIDEOS_TOTAL) {
      setResult(`Máximo de ${MAX_VIDEOS_TOTAL} vídeos por vez. Divida em lotes menores.`);
      return;
    }

    setLoading(true);
    setResult(null);
    setProgress(0);

    try {
      const fileArray = Array.from(files);
      const items = await uploadFiles(fileArray);

      if (mode === "autopilot") {
        await runAutopilot(items);
        return;
      }

      const hourList = parseHours(hours);
      if (!hourList.length) {
        setResult("Horário inválido. Use números de 0 a 23, ex: 9 ou 9,12,15");
        return;
      }

      setLoadingStep("Agendando posts...");

      const manualItems = items.map((item, i) => ({
        media_urls: item.media_urls,
        caption: captionTemplate.replace("{n}", String(i + 1)) || undefined,
      }));

      const bulkRes = await apiFetch("/api/posts/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          account_ids: selectedAccountIds,
          media_type: "REELS",
          items: manualItems,
          start_date: new Date(startDate).toISOString(),
          posts_per_day: postsPerDay,
          hours: hourList,
        }),
      });

      const bulkData = await readJsonResponse(bulkRes);
      if (!bulkRes.ok) {
        throw new Error(String(bulkData.error ?? "Falha no agendamento"));
      }

      const created = Number(bulkData.created ?? 0);
      const accountCount = Number(bulkData.accounts ?? selectedAccountIds.length);
      const videoCountResult = Number(bulkData.videos ?? fileArray.length);

      if (accountCount > 1) {
        setResult(
          `${created} posts agendados com sucesso! (${videoCountResult} vídeo(s) × ${accountCount} contas)`,
        );
      } else {
        setResult(`${created} posts agendados com sucesso!`);
      }
    } catch (err) {
      setResult(err instanceof Error ? err.message : "Erro desconhecido");
    } finally {
      setLoading(false);
      setLoadingStep("");
      setProgress(0);
    }
  }

  return (
    <>
      {showPreview && (
        <AutopilotPreview
          entries={previewEntries}
          accounts={previewAccounts}
          scheduleSummary={previewScheduleSummary}
          durationLabel={previewDurationLabel}
          captionSource={previewCaptionSource}
          totalPosts={previewTotalPosts}
          loading={confirming}
          onCaptionChange={handleCaptionChange}
          onConfirm={handleConfirmPreview}
          onCancel={closePreview}
        />
      )}

      <OnboardingSteps playbookReady={playbookReady} currentStep={2} />

      <form
        onSubmit={handleSubmit}
        className="space-y-6 rounded-2xl border border-ig-border bg-ig-elevated p-6"
      >
        {mode === "autopilot" && (
          <div className="rounded-lg border border-ig-warning/30 bg-ig-warning/10 px-4 py-3 text-sm text-ig-warning">
            <div className="mb-1 flex items-center gap-2 font-semibold text-ig-warning">
              <ShieldAlert size={16} />
              Dica anti-ban (opcional)
            </div>
            <p>
              Para contas novas, o modo <strong>Aquecimento</strong> distribui devagar (1→1→1→2→2
              posts/dia). Se preferir velocidade, use <strong>Automático</strong> ou{" "}
              <strong>Só hoje</strong> — você escolhe.
            </p>
          </div>
        )}

        {mode === "autopilot" && postingRisk?.warnings.length ? (
          <div className="rounded-lg border border-ig-warning/30 bg-ig-warning/10 px-4 py-3 text-sm text-ig-warning">
            {postingRisk.warnings.map((warning) => (
              <p key={warning}>{warning}</p>
            ))}
          </div>
        ) : null}

        {mode === "autopilot" && (
          <div className="text-center">
            <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-ig-primary/30 bg-ig-primary/10 px-3 py-1 text-xs text-ig-link">
              <Sparkles size={14} />
              Hands-off — você só envia os vídeos
            </div>
            <h2 className="text-xl font-bold text-ig-text">A IA faz o resto</h2>
            <p className="mt-1 text-sm text-ig-muted">
              Legendas, hashtags e horários estratégicos. Vídeo não é editado.
            </p>
          </div>
        )}

        {mode === "autopilot" && oneClickMode && (
          <div className="flex items-center gap-3 rounded-lg border border-emerald-500/20 bg-ig-success/10 px-4 py-3 text-sm text-ig-success">
            <Zap size={18} className="shrink-0 text-ig-success" />
            <p>
              <strong>Modo 1 clique ativo.</strong> Envie e a IA agenda tudo automaticamente — sem
              prévia.
            </p>
          </div>
        )}

        {mode === "autopilot" && (
          <div className="rounded-lg border border-ig-primary/20 bg-ig-primary/10 px-4 py-3 text-sm text-ig-link">
            <p>
              Envie até {MAX_VIDEOS_TOTAL} vídeos de uma vez
              {batchCount > 1 && (
                <> — processados em {batchCount} lotes automáticos de {API_BATCH_SIZE}</>
              )}
              . A IA usa seu{" "}
              <a href="/dashboard/ai" className="font-medium underline">
                playbook GPT
              </a>{" "}
              e distribui nos melhores horários.
            </p>
          </div>
        )}

        {showAdvanced && mode === "manual" && (
          <button
            type="button"
            onClick={() => {
              setMode("autopilot");
              setShowAdvanced(false);
            }}
            className="text-sm text-ig-primary hover:underline"
          >
            ← Voltar ao modo automático
          </button>
        )}

        <div>
          <div className="mb-3 flex items-center justify-between gap-3">
            <label className="block text-sm text-ig-text">
              {accounts.length > 1 ? "Contas Instagram (agendamento simultâneo)" : "Conta Instagram"}
            </label>
            {accounts.length > 1 && (
              <button
                type="button"
                onClick={toggleAllAccounts}
                className="text-xs text-ig-primary hover:underline"
              >
                {allSelected ? "Desmarcar extras" : "Selecionar todas"}
              </button>
            )}
          </div>

          {accounts.length > 1 ? (
            <div className="space-y-2 rounded-lg border border-ig-border bg-ig-elevated p-3">
              {accounts.map((account) => {
                const checked = selectedAccountIds.includes(account.id);
                return (
                  <label
                    key={account.id}
                    className={`flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2 transition ${
                      checked
                        ? "border-ig-primary/40 bg-ig-primary/10"
                        : "border-ig-border bg-ig-elevated hover:bg-ig-secondary"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleAccount(account.id)}
                      className="h-4 w-4 rounded border-ig-border bg-ig-secondary text-ig-primary"
                    />
                    {account.profile_picture_url ? (
                      <img
                        src={account.profile_picture_url}
                        alt={account.ig_username ?? "Instagram"}
                        className="h-8 w-8 rounded-full border border-ig-border object-cover"
                      />
                    ) : (
                      <div className="flex h-8 w-8 items-center justify-center rounded-full border border-ig-border bg-ig-secondary text-xs text-ig-link">
                        IG
                      </div>
                    )}
                    <span className="text-sm text-ig-text">@{account.ig_username}</span>
                  </label>
                );
              })}
            </div>
          ) : (
            <select
              value={selectedAccountIds[0] ?? ""}
              onChange={(e) => setSelectedAccountIds([e.target.value])}
              className="w-full ig-input w-full"
            >
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  @{a.ig_username}
                </option>
              ))}
            </select>
          )}

          {!selectedAccountIds.length && (
            <p className="mt-2 text-xs text-ig-danger">Selecione pelo menos uma conta.</p>
          )}
        </div>

        <div>
          <label className="mb-2 block text-sm text-ig-text">Vídeo(s)</label>
          <input
            type="file"
            accept="video/*"
            multiple
            onChange={(e) => setFiles(e.target.files)}
            className="w-full rounded-lg border border-dashed border-ig-border bg-ig-elevated px-3 py-4 text-sm text-ig-text file:mr-3 file:rounded-md file:border-0 file:bg-ig-primary file:px-3 file:py-2 file:text-sm file:font-medium file:text-ig-text"
          />
          <p className="mt-2 text-xs text-ig-muted">
            {mode === "autopilot"
              ? "Suba seus vídeos prontos. A IA só define legenda, hashtags e horário — sem mexer no vídeo."
              : "Para teste, escolha apenas 1 vídeo. Máximo 500MB por arquivo."}
          </p>
          {files && (
            <div className="mt-2 space-y-1">
              <p className="text-xs text-ig-success">
                {files.length} arquivo(s) selecionado(s)
                {selectedAccountIds.length > 1 && (
                  <> · total de {totalPosts} post(s) em {selectedAccountIds.length} contas</>
                )}
              </p>
              {scheduleEstimate && (
                <p className="flex items-center gap-1.5 text-xs text-ig-link">
                  <Calendar size={12} />
                  Estimativa: {scheduleEstimate.label}
                </p>
              )}
            </div>
          )}
        </div>

        {mode === "autopilot" ? (
          <div>
            <label className="mb-2 block text-sm text-ig-text">Distribuição (IA decide)</label>
            <div className="grid gap-2 sm:grid-cols-3">
              <button
                type="button"
                onClick={() => setScheduleMode("warmup")}
                className={`rounded-xl border px-4 py-3 text-left text-sm transition ${
                  scheduleMode === "warmup"
                    ? "border-amber-500/50 bg-ig-warning/15 text-ig-warning"
                    : "border-ig-border bg-ig-elevated text-ig-muted"
                }`}
              >
                <strong className="flex items-center gap-1.5">
                  <Flame size={14} />
                  Aquecimento
                </strong>
                <span className="text-xs opacity-80">
                  {describeWarmupPlan(DEFAULT_WARMUP_DAYS)} — ideal para contas novas
                </span>
              </button>
              <button
                type="button"
                onClick={() => setScheduleMode("auto")}
                className={`rounded-xl border px-4 py-3 text-left text-sm transition ${
                  scheduleMode === "auto"
                    ? "border-ig-primary/50 bg-ig-primary/15 text-ig-link"
                    : "border-ig-border bg-ig-elevated text-ig-muted"
                }`}
              >
                <strong className="block">Automático</strong>
                <span className="text-xs opacity-80">
                  Semanas/meses — IA distribui 1-3 posts/dia nos horários de pico
                </span>
              </button>
              <button
                type="button"
                onClick={() => setScheduleMode("today")}
                className={`rounded-xl border px-4 py-3 text-left text-sm transition ${
                  scheduleMode === "today"
                    ? "border-ig-primary/50 bg-ig-primary/15 text-ig-link"
                    : "border-ig-border bg-ig-elevated text-ig-muted"
                }`}
              >
                <strong className="block">Só hoje</strong>
                <span className="text-xs opacity-80">Todos os vídeos ainda hoje</span>
              </button>
            </div>
            {scheduleMode === "warmup" && hasWarmupAccounts && (
              <p className="mt-2 text-xs text-ig-warning/80">
                Cada conta segue sua própria rampa de aquecimento conforme o dia em que foi conectada.
              </p>
            )}
          </div>
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-2 block text-sm text-ig-text">Data de início</label>
                <input
                  type="datetime-local"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="w-full ig-input w-full"
                  required
                />
              </div>
              <div>
                <label className="mb-2 block text-sm text-ig-text">Posts por dia</label>
                <input
                  type="number"
                  min={1}
                  max={10}
                  value={postsPerDay}
                  onChange={(e) => setPostsPerDay(Number(e.target.value))}
                  className="w-full ig-input w-full"
                />
              </div>
            </div>

            <div>
              <label className="mb-2 block text-sm text-ig-text">
                Horários (hora cheia, ex: 9 ou 9,12,15)
              </label>
              <input
                type="text"
                value={hours}
                onChange={(e) => setHours(e.target.value)}
                className="w-full ig-input w-full"
                placeholder="9"
              />
            </div>

            <div>
              <label className="mb-2 block text-sm text-ig-text">
                Legenda padrão (use {"{n}"} para número do post)
              </label>
              <textarea
                value={captionTemplate}
                onChange={(e) => setCaptionTemplate(e.target.value)}
                rows={3}
                className="w-full ig-input w-full"
                placeholder="Post #{n} 🎬"
              />
            </div>
          </>
        )}

        {mode === "autopilot" && (
          <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-ig-border bg-ig-elevated px-4 py-3">
            <input
              type="checkbox"
              checked={!oneClickMode}
              onChange={(e) => setOneClickMode(!e.target.checked)}
              disabled={videoCount > MAX_PREVIEW_VIDEOS}
              className="h-4 w-4 rounded border-ig-border bg-ig-secondary text-ig-primary"
            />
            <div>
              <p className="text-sm text-ig-text">Revisar prévia antes de agendar</p>
              <p className="text-xs text-ig-muted">
                {videoCount > MAX_PREVIEW_VIDEOS
                  ? `Disponível até ${MAX_PREVIEW_VIDEOS} vídeos. Acima disso, usa modo 1 clique.`
                  : "Desmarque para agendar direto em 1 clique (recomendado)."}
              </p>
            </div>
          </label>
        )}

        {mode === "autopilot" && !showAdvanced && (
          <button
            type="button"
            onClick={() => {
              setMode("manual");
              setShowAdvanced(true);
            }}
            className="flex w-full items-center justify-center gap-2 text-xs text-ig-muted hover:text-ig-text"
          >
            <Settings2 size={14} />
            Modo avançado (configurar manualmente)
          </button>
        )}

        {loading && progress > 0 && (
          <div className="space-y-2">
            <div className="h-2 overflow-hidden rounded-full bg-ig-secondary">
              <div
                className="h-full rounded-full bg-ig-primary transition-all duration-300"
                style={{ width: `${progress}%` }}
              />
            </div>
            <p className="text-center text-xs text-ig-muted">{loadingStep}</p>
          </div>
        )}

        <button
          type="submit"
          disabled={loading || !selectedAccountIds.length}
          className="ig-btn w-full py-3 disabled:opacity-50"
        >
          {loading
            ? loadingStep || "Processando..."
            : mode === "autopilot"
              ? files?.length
                ? oneClickMode || videoCount > MAX_PREVIEW_VIDEOS
                  ? `Programar ${totalPosts} Reels — 1 clique`
                  : `Gerar prévia de ${totalPosts} Reels`
                : "Enviar vídeos — IA programa tudo"
              : selectedAccountIds.length > 1 && files?.length
                ? `Agendar ${totalPosts} posts (${files.length} vídeo(s) × ${selectedAccountIds.length} contas)`
                : files?.length === 1
                  ? "Agendar 1 post"
                  : "Agendar em massa"}
        </button>

        {result && (
          <p
            className={`text-sm ${result.includes("agendad") ? "text-ig-success" : "text-ig-danger"}`}
          >
            {result}
          </p>
        )}
      </form>
    </>
  );
}
