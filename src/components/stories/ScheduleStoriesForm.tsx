"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Check, ImagePlus, Loader2, Smartphone } from "lucide-react";
import { formatApiError } from "@/lib/api-errors";
import { CONTENT_TYPE_LABELS } from "@/lib/content-types";
import { formatDateTime } from "@/lib/utils";
import {
  STORY_CTA_OPTIONS,
  STORY_OBJECTIVES,
  type StoryPreviewEntry,
} from "@/lib/stories/types";
import {
  ProductCampaignSelector,
  type ProductCampaignSelection,
} from "@/components/products/ProductCampaignSelector";
import type { InstagramAccount } from "@/lib/types";

type ScheduleMode = "auto" | "today" | "custom";

interface UploadedItem {
  file: File;
  media_url: string;
  filename: string;
}

interface CapabilityState {
  autoPublishReady: boolean;
  message: string;
  loading: boolean;
}

interface Props {
  accounts: InstagramAccount[];
  defaultAccountId?: string;
}

async function apiFetch(input: RequestInfo | URL, init?: RequestInit) {
  const response = await fetch(input, { ...init, credentials: "include" });
  if (response.status === 401) {
    window.location.href = "/login?next=/dashboard/stories";
    throw new Error("Sessão expirada. Faça login novamente.");
  }
  return response;
}

async function readJson(response: Response) {
  const data = await response.json();
  if (!response.ok) {
    throw new Error(formatApiError(data.error ?? data) || "Erro na requisição");
  }
  return data;
}

function StoryPhonePreview({ entry }: { entry: StoryPreviewEntry }) {
  const isVideo = /\.(mp4|mov|webm)$/i.test(entry.media_url);

  return (
    <div className="mx-auto w-full max-w-[220px]">
      <div className="relative aspect-[9/16] overflow-hidden rounded-3xl border-4 border-ig-border bg-black shadow-lg">
        {isVideo ? (
          <video src={entry.media_url} className="h-full w-full object-cover" muted playsInline />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={entry.media_url} alt="" className="h-full w-full object-cover" />
        )}
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent p-4 pt-16">
          <p className="whitespace-pre-wrap text-sm font-medium text-white">{entry.story_text}</p>
          <p className="mt-2 text-xs font-semibold uppercase tracking-wide text-white/90">
            {entry.story_cta}
          </p>
        </div>
        <div className="absolute left-3 top-3 rounded-full bg-black/50 px-2 py-1 text-[10px] font-medium text-white">
          Story
        </div>
      </div>
      <p className="mt-2 text-center text-xs text-ig-muted">{formatDateTime(entry.scheduled_at)}</p>
    </div>
  );
}

export function ScheduleStoriesForm({ accounts, defaultAccountId }: Props) {
  const router = useRouter();
  const [accountId, setAccountId] = useState(defaultAccountId ?? accounts[0]?.id ?? "");
  const [items, setItems] = useState<UploadedItem[]>([]);
  const [uploading, setUploading] = useState(false);
  const [objective, setObjective] = useState<string>(STORY_OBJECTIVES[0]);
  const [cta, setCta] = useState<string>(STORY_CTA_OPTIONS[0]);
  const [storyLink, setStoryLink] = useState("");
  const [scheduleMode, setScheduleMode] = useState<ScheduleMode>("auto");
  const [customPostsPerDay, setCustomPostsPerDay] = useState(6);
  const [preview, setPreview] = useState<StoryPreviewEntry[] | null>(null);
  const [schedule, setSchedule] = useState<string[]>([]);
  const [scheduleSummary, setScheduleSummary] = useState("");
  const [textSource, setTextSource] = useState<string | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [campaignSelection, setCampaignSelection] = useState<ProductCampaignSelection>({
    productId: null,
    campaignId: null,
    contentObjective: null,
  });
  const [capability, setCapability] = useState<CapabilityState>({
    autoPublishReady: false,
    message: "",
    loading: true,
  });

  const selectedAccount = useMemo(
    () => accounts.find((account) => account.id === accountId),
    [accounts, accountId],
  );

  const loadCapability = useCallback(async () => {
    if (!accountId) return;
    setCapability((prev) => ({ ...prev, loading: true }));
    try {
      const res = await apiFetch(`/api/stories/capabilities?accountId=${accountId}`);
      const data = await readJson(res);
      setCapability({
        autoPublishReady: Boolean(data.autoPublishReady),
        message: String(data.message ?? ""),
        loading: false,
      });
    } catch (err) {
      setCapability({
        autoPublishReady: false,
        message: err instanceof Error ? err.message : "Não foi possível validar permissão de Stories.",
        loading: false,
      });
    }
  }, [accountId]);

  useEffect(() => {
    void loadCapability();
  }, [loadCapability]);

  async function handleFilesSelected(fileList: FileList | null) {
    if (!fileList?.length) return;
    setError(null);
    setPreview(null);
    setSuccess(null);
    setUploading(true);

    try {
      const formData = new FormData();
      Array.from(fileList).forEach((file) => formData.append("files", file));

      const res = await apiFetch("/api/upload", { method: "POST", body: formData });
      const data = await readJson(res);
      const urls = (data.urls as string[]) ?? [];

      const uploaded = urls.map((media_url, index) => ({
        media_url,
        filename: fileList[index]?.name ?? `story-${index + 1}`,
        file: fileList[index]!,
      }));

      setItems((prev) => [...prev, ...uploaded]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha no upload");
    } finally {
      setUploading(false);
    }
  }

  function removeItem(index: number) {
    setItems((prev) => prev.filter((_, i) => i !== index));
    setPreview(null);
  }

  function buildCampaignPayload() {
    return {
      product_id: campaignSelection.productId,
      campaign_id: campaignSelection.campaignId,
      content_objective: campaignSelection.contentObjective ?? objective,
    };
  }

  async function generatePreview() {
    if (!accountId || !items.length) {
      setError("Selecione uma conta e envie pelo menos um arquivo.");
      return;
    }

    setLoadingPreview(true);
    setError(null);
    setSuccess(null);

    try {
      const res = await apiFetch("/api/stories/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          account_id: accountId,
          story_objective: objective,
          story_cta: cta,
          story_link: storyLink.trim() || null,
          schedule_mode: scheduleMode,
          custom_schedule:
            scheduleMode === "custom"
              ? { posts_per_day: customPostsPerDay, time_slots: [] }
              : undefined,
          items: items.map((item) => ({
            media_url: item.media_url,
            filename: item.filename,
          })),
          ...buildCampaignPayload(),
        }),
      });

      const data = await readJson(res);
      setPreview((data.preview as StoryPreviewEntry[]) ?? []);
      setSchedule((data.schedule as string[]) ?? []);
      setScheduleSummary(String(data.schedule_summary ?? ""));
      setTextSource(String(data.text_source ?? ""));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao gerar prévia");
    } finally {
      setLoadingPreview(false);
    }
  }

  function updatePreviewText(index: number, story_text: string) {
    setPreview((prev) =>
      prev?.map((entry) => (entry.index === index ? { ...entry, story_text } : entry)) ?? null,
    );
  }

  async function confirmSchedule() {
    if (!preview?.length || !schedule.length) {
      setError("Gere a prévia antes de confirmar.");
      return;
    }

    setConfirming(true);
    setError(null);

    try {
      const res = await apiFetch("/api/stories/schedule", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          account_id: accountId,
          schedule,
          items: preview.map((entry) => ({
            media_url: entry.media_url,
            filename: entry.filename,
            story_text: entry.story_text,
            story_cta: entry.story_cta,
            story_link: entry.story_link,
            story_objective: entry.story_objective,
          })),
          ...buildCampaignPayload(),
        }),
      });

      const data = await readJson(res);
      const created = Number(data.created ?? 0);
      const blockReason = data.publish_block_reason as string | null;

      if (blockReason) {
        setSuccess(
          `${created} story(s) agendado(s). Publicação automática aguardando permissão da Meta: ${blockReason}`,
        );
      } else {
        setSuccess(`${created} story(s) agendado(s) com publicação automática ativa.`);
      }

      setItems([]);
      setPreview(null);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao agendar");
    } finally {
      setConfirming(false);
    }
  }

  return (
    <div className="space-y-6">
      {!capability.loading && (
        <div
          className={`rounded-2xl border px-5 py-4 ${
            capability.autoPublishReady
              ? "border-ig-info-border bg-ig-info-bg"
              : "border-amber-500/30 bg-amber-500/10"
          }`}
        >
          <div className="flex items-start gap-3">
            {capability.autoPublishReady ? (
              <Check className="mt-0.5 h-5 w-5 shrink-0 text-ig-primary" />
            ) : (
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
            )}
            <div>
              <p className="font-semibold text-ig-text">
                {capability.autoPublishReady
                  ? "Publicação automática de Stories disponível"
                  : "Stories serão salvos como agendados"}
              </p>
              <p className="mt-1 text-sm text-ig-muted">{capability.message}</p>
            </div>
          </div>
        </div>
      )}

      <section className="rounded-2xl border border-ig-border bg-ig-elevated p-6">
        <h2 className="text-lg font-semibold text-ig-text">1. Conta Instagram</h2>
        <select
          value={accountId}
          onChange={(event) => {
            setAccountId(event.target.value);
            setPreview(null);
          }}
          className="mt-3 w-full rounded-xl border border-ig-border bg-ig-secondary px-4 py-3 text-sm text-ig-text"
        >
          {accounts.map((account) => (
            <option key={account.id} value={account.id}>
              @{account.ig_username ?? "conta"}
            </option>
          ))}
        </select>
      </section>

      <section className="rounded-2xl border border-ig-border bg-ig-elevated p-6">
        <h2 className="text-lg font-semibold text-ig-text">2. Mídia do Story</h2>
        <p className="mt-1 text-sm text-ig-muted">Envie imagens ou vídeos verticais (9:16 recomendado).</p>

        <label className="mt-4 flex cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed border-ig-border bg-ig-secondary px-6 py-10 transition hover:border-ig-primary">
          <input
            type="file"
            accept="image/*,video/*"
            multiple
            className="hidden"
            disabled={uploading}
            onChange={(event) => void handleFilesSelected(event.target.files)}
          />
          {uploading ? (
            <Loader2 className="h-8 w-8 animate-spin text-ig-primary" />
          ) : (
            <ImagePlus className="h-8 w-8 text-ig-muted" />
          )}
          <span className="mt-3 text-sm font-medium text-ig-text">
            {uploading ? "Enviando..." : "Clique para enviar arquivos"}
          </span>
        </label>

        {items.length > 0 && (
          <ul className="mt-4 space-y-2">
            {items.map((item, index) => (
              <li
                key={`${item.media_url}-${index}`}
                className="flex items-center justify-between gap-3 rounded-xl border border-ig-border bg-ig-secondary px-4 py-3 text-sm"
              >
                <span className="truncate text-ig-text">{item.filename}</span>
                <button
                  type="button"
                  onClick={() => removeItem(index)}
                  className="text-xs text-ig-danger hover:underline"
                >
                  Remover
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-2xl border border-ig-border bg-ig-elevated p-6">
        <h2 className="text-lg font-semibold text-ig-text">3. Produto / Campanha</h2>
        <div className="mt-4">
          <ProductCampaignSelector
            value={campaignSelection}
            onChange={setCampaignSelection}
            compact
          />
        </div>
      </section>

      <section className="rounded-2xl border border-ig-border bg-ig-elevated p-6">
        <h2 className="text-lg font-semibold text-ig-text">4. Objetivo e CTA</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-2 block text-sm text-ig-muted">Objetivo do story</label>
            <select
              value={objective}
              onChange={(event) => {
                setObjective(event.target.value);
                setPreview(null);
              }}
              className="w-full rounded-xl border border-ig-border bg-ig-secondary px-4 py-3 text-sm"
            >
              {STORY_OBJECTIVES.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-2 block text-sm text-ig-muted">CTA</label>
            <select
              value={cta}
              onChange={(event) => {
                setCta(event.target.value);
                setPreview(null);
              }}
              className="w-full rounded-xl border border-ig-border bg-ig-secondary px-4 py-3 text-sm"
            >
              {STORY_CTA_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="mt-4">
          <label className="mb-2 block text-sm text-ig-muted">Link (opcional)</label>
          <input
            type="url"
            value={storyLink}
            onChange={(event) => {
              setStoryLink(event.target.value);
              setPreview(null);
            }}
            placeholder="https://..."
            className="w-full rounded-xl border border-ig-border bg-ig-secondary px-4 py-3 text-sm"
          />
        </div>
      </section>

      <section className="rounded-2xl border border-ig-border bg-ig-elevated p-6">
        <h2 className="text-lg font-semibold text-ig-text">5. Horários</h2>
        <div className="mt-4 flex flex-wrap gap-2">
          {(
            [
              ["auto", "Automático"],
              ["today", "Publicar hoje"],
              ["custom", "Personalizado"],
            ] as const
          ).map(([mode, label]) => (
            <button
              key={mode}
              type="button"
              onClick={() => {
                setScheduleMode(mode);
                setPreview(null);
              }}
              className={`rounded-full px-4 py-2 text-sm transition ${
                scheduleMode === mode
                  ? "bg-ig-primary text-ig-on-primary"
                  : "border border-ig-border bg-ig-secondary text-ig-text"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        {scheduleMode === "custom" && (
          <div className="mt-4">
            <label className="mb-2 block text-sm text-ig-muted">Stories por dia</label>
            <input
              type="number"
              min={1}
              max={24}
              value={customPostsPerDay}
              onChange={(event) => {
                setCustomPostsPerDay(Number(event.target.value));
                setPreview(null);
              }}
              className="w-32 rounded-xl border border-ig-border bg-ig-secondary px-4 py-3 text-sm"
            />
          </div>
        )}
        <button
          type="button"
          onClick={() => void generatePreview()}
          disabled={loadingPreview || !items.length}
          className="ig-btn mt-5 gap-2 px-5 py-3 text-sm disabled:opacity-50"
        >
          {loadingPreview ? <Loader2 className="h-4 w-4 animate-spin" /> : <Smartphone className="h-4 w-4" />}
          Gerar prévia
        </button>
      </section>

      {preview && preview.length > 0 && (
        <section className="rounded-2xl border border-ig-border bg-ig-elevated p-6">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-ig-text">6. Prévia dos Stories</h2>
              <p className="text-sm text-ig-muted">
                {scheduleSummary}
                {textSource ? ` · Textos: ${textSource === "ai" ? "IA" : "modelo"}` : ""}
              </p>
            </div>
            <span className="rounded-full bg-ig-secondary px-3 py-1 text-xs font-medium text-ig-text">
              {CONTENT_TYPE_LABELS.story}
            </span>
          </div>

          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {preview.map((entry) => (
              <div key={entry.index} className="space-y-3">
                <StoryPhonePreview entry={entry} />
                <textarea
                  value={entry.story_text}
                  onChange={(event) => updatePreviewText(entry.index, event.target.value)}
                  rows={4}
                  className="w-full rounded-xl border border-ig-border bg-ig-secondary px-3 py-2 text-sm"
                />
              </div>
            ))}
          </div>

          <button
            type="button"
            onClick={() => void confirmSchedule()}
            disabled={confirming}
            className="ig-btn mt-6 gap-2 px-6 py-3 text-sm font-semibold disabled:opacity-50"
          >
            {confirming ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
            Confirmar agendamento
          </button>
        </section>
      )}

      {error && (
        <div className="rounded-2xl border border-ig-danger/30 bg-ig-danger/10 px-5 py-4 text-sm text-ig-danger">
          {error}
        </div>
      )}

      {success && (
        <div className="rounded-2xl border border-ig-info-border bg-ig-info-bg px-5 py-4 text-sm text-ig-text">
          {success}{" "}
          <a href="/dashboard/reports?content_type=story" className="font-medium text-ig-primary hover:underline">
            Ver na Central de Operações
          </a>
        </div>
      )}

      {selectedAccount && (
        <p className="text-center text-xs text-ig-muted">
          Conta selecionada: @{selectedAccount.ig_username ?? "conta"}
        </p>
      )}
    </div>
  );
}
