"use client";

import { memo, useEffect, useMemo } from "react";
import { Loader2, Pause, Play, Upload } from "lucide-react";
import {
  useUploadSession,
  useUploadSessionStore,
} from "@/contexts/UploadSessionProvider";
import { deriveUploadSessionView } from "@/lib/upload/session-derived";
import { fileStatusLabel, getCompletedUploadItems } from "@/lib/upload/client";
import { getFileDisplayPercent } from "@/lib/upload/batch-status";
import { displayUploadErrorMessage, formatUploadErrorMessage } from "@/lib/upload/errors";
import { formatBytes } from "@/lib/upload/validate";
import { getSpeedPresets, MAX_VIDEOS_PER_BATCH } from "@/lib/upload/storage-config";
import { BATCH_UPLOAD_LIMIT_MESSAGE } from "@/lib/autopilot-constants";
import {
  largeBatchAdaptiveMessage,
  recommendSpeedModeForBatch,
  turboLargeBatchConfirmMessage,
} from "@/lib/upload/adaptive";
import { largeBatchWarning } from "@/lib/upload/queue";
import { uploadSessionStore } from "@/lib/upload/session-store";
import { isUploadBatchFullyScheduled, isUploadBatchTerminal } from "@/lib/upload/batch-terminal";
import { BatchCompletionActions } from "@/components/upload/BatchCompletionActions";
import type { UploadBatch, UploadBatchFile, UploadSpeedMode } from "@/lib/types";

function resumeButtonLabel() {
  return "Retomar upload";
}

interface Props {
  accountId: string;
  accountLabel?: string;
  platform?: UploadBatch["platform"];
  scheduleMode: UploadBatch["schedule_mode"];
  customSchedule?: UploadBatch["custom_schedule"];
  onBatchUpdate?: (batch: UploadBatch | null) => void;
  onUploadingChange?: (uploading: boolean) => void;
  onSchedulePartial?: () => void;
  onScheduleAll?: () => void;
  canScheduleAll?: boolean;
  scheduleAllBusy?: boolean;
  onStartNewBatch?: () => void;
  suppressCompletionActions?: boolean;
  /** Job de agendamento em andamento no servidor (upload já recebido). */
  scheduleJobActive?: boolean;
  scheduleJobComplete?: boolean;
}

const FileStatusRow = memo(function FileStatusRow({
  file,
  percent,
  maxUploadBytes,
  onRetry,
  isStalled,
  isRetrying,
  runtimeStatus,
}: {
  file: UploadBatchFile;
  percent: number;
  maxUploadBytes: number;
  onRetry: (file: UploadBatchFile) => void;
  isStalled?: boolean;
  isRetrying?: boolean;
  runtimeStatus?: string;
}) {
  const extIdx = file.filename.lastIndexOf(".");
  const ext = extIdx > 0 ? file.filename.slice(extIdx) : "";
  const safeDisplayName =
    file.filename.length <= 56
      ? file.filename
      : `${file.filename.slice(0, 44)}...${ext}`;
  const errorText = displayUploadErrorMessage(
    file.error_message,
    Number(file.file_size),
    maxUploadBytes,
  );

  return (
    <div className="rounded-lg border border-ig-border bg-ig-secondary px-3 py-2 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="truncate text-ig-text" title={file.filename}>
          {safeDisplayName}
        </span>
        <span className="text-xs text-ig-muted">
          {formatBytes(Number(file.file_size))} ·{" "}
          {fileStatusLabel(file.status, {
            stalled: isStalled,
            retrying: isRetrying,
            runtimeStatus,
          })}
        </span>
      </div>
      {(file.status === "uploading" || file.status === "retrying" || percent > 0) &&
        file.status !== "completed" && (
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-ig-elevated">
          <div className="h-full rounded-full bg-ig-primary" style={{ width: `${percent || 5}%` }} />
        </div>
      )}
      {file.status === "failed" && (
        <div className="mt-2 space-y-1">
          {errorText && <p className="text-xs text-ig-danger">{errorText}</p>}
          <button
            type="button"
            onClick={() => onRetry(file)}
            className="text-xs font-medium text-ig-primary hover:underline"
          >
            Tentar novamente
          </button>
        </div>
      )}
    </div>
  );
});

export function SupremeUploadManager({
  accountId,
  accountLabel,
  platform = "instagram",
  scheduleMode,
  customSchedule,
  onBatchUpdate,
  onUploadingChange,
  onSchedulePartial,
  onScheduleAll,
  canScheduleAll = false,
  scheduleAllBusy = false,
  onStartNewBatch,
  suppressCompletionActions = false,
  scheduleJobActive = false,
  scheduleJobComplete = false,
}: Props) {
  const store = useUploadSessionStore();
  const session = useUploadSession();

  useEffect(() => {
    store.configureSession({ accountId, platform, scheduleMode, customSchedule });
  }, [store, accountId, platform, scheduleMode, customSchedule]);

  useEffect(() => {
    void store.reconcileOnForeground();
  }, [store]);

  useEffect(() => {
    return store.registerBatchListener(onBatchUpdate ?? null);
  }, [store, onBatchUpdate]);

  useEffect(() => {
    const hasFileRetry = Object.values(session.fileRuntime).some(
      (runtime) => runtime.status === "retrying",
    );
    const isActive =
      session.running ||
      session.engineStarting ||
      session.recoveringFromStall ||
      session.retrying ||
      session.resuming ||
      hasFileRetry;
    onUploadingChange?.(isActive);
  }, [
    session.running,
    session.engineStarting,
    session.recoveringFromStall,
    session.retrying,
    session.resuming,
    session.fileRuntime,
    onUploadingChange,
  ]);

  const view = useMemo(
    () =>
      deriveUploadSessionView({
        batch: session.batch,
        progress: session.progress,
        progressMap: session.progressMap,
        running: session.running,
        pausedByUser: session.pausedByUser,
        retrying: session.retrying,
        resuming: session.resuming,
        canResumeWithoutPicker: session.canResumeWithoutPicker,
        needsFileReselection: session.needsFileReselection,
        fileRuntime: session.fileRuntime,
        engineStarting: session.engineStarting,
        recoveringFromStall: session.recoveringFromStall,
        batchStalled: session.batchStalled,
      }),
    [
      session.batch,
      session.progress,
      session.progressMap,
      session.running,
      session.pausedByUser,
      session.retrying,
      session.resuming,
      session.canResumeWithoutPicker,
      session.needsFileReselection,
      session.fileRuntime,
      session.engineStarting,
      session.recoveringFromStall,
      session.batchStalled,
    ],
  );

  const hasFileRetry = Object.values(session.fileRuntime).some(
    (runtime) => runtime.status === "retrying",
  );

  const batchStatus = session.batch?.status;
  const batchTerminal = isUploadBatchTerminal(batchStatus);
  const batchFullyScheduled = isUploadBatchFullyScheduled(batchStatus);
  const uploadFullyReceived =
    view.totalCount > 0 &&
    view.completedCount >= view.totalCount &&
    !view.isActivelyUploading &&
    !session.running &&
    !session.retrying &&
    !hasFileRetry;
  const showReceivedForSchedule =
    scheduleJobActive && (batchTerminal || uploadFullyReceived || batchStatus === "ready");
  const scheduleProcessingLabel = scheduleJobComplete
    ? "Processamento finalizado"
    : "Processamento no servidor";
  const uploadReadyForAiSchedule =
    uploadFullyReceived &&
    batchStatus === "ready" &&
    !scheduleJobActive &&
    !batchFullyScheduled;
  const showUploadCompletionActions =
    (batchFullyScheduled ||
      batchStatus === "cancelled" ||
      (uploadFullyReceived && scheduleJobActive && scheduleJobComplete)) &&
    !suppressCompletionActions &&
    Boolean(onStartNewBatch);

  const handleStartNewBatch = async () => {
    if (onStartNewBatch) {
      onStartNewBatch();
      return;
    }
    await uploadSessionStore.startNewBatch();
  };

  const maxUploadBytes = (session.uploadLimits?.max_upload_mb ?? 500) * 1024 * 1024;
  const speedPresets =
    session.uploadLimits?.speed_presets ?? getSpeedPresets(session.uploadLimits?.concurrency);
  const batchFileCount =
    session.batch?.total_files ??
    session.validationPreview?.validCount ??
    0;
  const maxUploadLabel =
    session.uploadLimits?.max_upload_mb && session.uploadLimits.max_upload_mb >= 1024
      ? `${session.uploadLimits.max_upload_mb / 1024}GB`
      : `${session.uploadLimits?.max_upload_mb ?? 500}MB`;
  const username =
    accountLabel ??
    (session.batch?.platform === "tiktok"
      ? session.batch.tiktok_accounts?.username ??
        session.batch.tiktok_accounts?.display_name
      : session.batch?.instagram_accounts?.ig_username);

  if (session.initialLoading) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-ig-border bg-ig-secondary px-4 py-6 text-sm text-ig-muted">
        <Loader2 size={16} className="animate-spin" />
        Carregando sistema de upload...
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {session.uploadLimits?.bucket_limit_mb != null && session.uploadLimits.bucket_limit_mb <= 50 && (
        <div className="rounded-xl border border-ig-danger/30 bg-ig-danger/10 px-4 py-3 text-sm text-ig-danger">
          O bucket Supabase ainda limita arquivos a{" "}
          <strong>{session.uploadLimits.bucket_limit_label ?? "50 MB"}</strong>.
        </div>
      )}

      <p className="rounded-xl border border-ig-info-border bg-ig-info-bg px-4 py-3 text-sm text-ig-muted">
        Você pode trocar de aba, navegar pelo site (Dashboard, Relatórios, Contas…) — o upload{" "}
        <strong className="text-ig-text">continua em segundo plano</strong>.
        Acompanhe o progresso na <strong className="text-ig-text">barra flutuante</strong> no rodapé.
      </p>

      <p className="rounded-xl border border-ig-info-border bg-ig-info-bg px-4 py-3 text-sm text-ig-muted">
        {BATCH_UPLOAD_LIMIT_MESSAGE}
      </p>

      {showReceivedForSchedule && (
        <p className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-900 dark:text-amber-200">
          Seu lote foi recebido. Vamos processar os vídeos em fila — você pode sair da página e
          acompanhar o progresso depois.
        </p>
      )}
      {!session.initialLoading && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-ig-border bg-ig-secondary px-4 py-3">
          <span className="text-xs text-ig-muted">
            Limpeza · @{username ?? "conta"} ({platform === "tiktok" ? "TikTok" : "Instagram"})
          </span>
          <button
            type="button"
            className="rounded-lg border border-ig-danger/40 px-3 py-1.5 text-xs text-ig-danger hover:bg-ig-danger/10"
            disabled={session.running}
            onClick={() => void uploadSessionStore.clearAccountVideos(username ?? "conta")}
          >
            Apagar vídeos enviados
          </button>
          <button
            type="button"
            className="rounded-lg border border-ig-danger/40 px-3 py-1.5 text-xs text-ig-danger hover:bg-ig-danger/10"
            disabled={session.running}
            onClick={() => void uploadSessionStore.clearAccountBatches(username ?? "conta")}
          >
            Apagar lotes desta conta
          </button>
        </div>
      )}

      {view.canResume && (
        <div className="space-y-3 rounded-2xl border border-ig-info-border bg-ig-info-bg p-4">
          <div>
            <p className="font-semibold text-ig-text">Upload pausado</p>
            <p className="mt-1 text-sm text-ig-muted">
              {view.completedCount} de {view.totalCount} já enviados · seus arquivos ainda estão nesta sessão
            </p>
          </div>
          <button
            type="button"
            className="ig-btn inline-flex items-center gap-2 px-5 py-2.5 text-sm"
            disabled={session.resuming}
            onClick={() => void uploadSessionStore.resumePausedUpload()}
          >
            {session.resuming ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <Play size={16} />
            )}
            {resumeButtonLabel()}
          </button>
        </div>
      )}

      {view.canSelectFiles && (
        <div className="space-y-3 rounded-2xl border border-ig-info-border bg-ig-info-bg p-4">
          <div>
            <p className="font-semibold text-ig-text">Falta enviar alguns vídeos</p>
            <p className="mt-1 text-sm text-ig-muted">
              {view.completedCount} de {view.totalCount} já enviados
              {view.failedCount > 0 ? ` · ${view.failedCount} com erro` : ""}
              {" · "}selecione os vídeos no computador para continuar
            </p>
          </div>
          <button
            type="button"
            className="ig-btn inline-flex items-center gap-2 px-5 py-2.5 text-sm"
            disabled={session.resuming}
            onClick={() => uploadSessionStore.openChooseVideos()}
          >
            <Upload size={16} />
            Selecionar arquivos novamente
          </button>
        </div>
      )}

      {view.awaitingAutoRecovery && (
        <div className="flex items-center gap-2 rounded-xl border border-ig-info-border bg-ig-info-bg px-4 py-3 text-sm text-ig-muted">
          <Loader2 size={16} className="animate-spin text-ig-primary" />
          {session.message ?? "Tentando continuar automaticamente…"}
        </div>
      )}

      {(!session.batch || view.isEmptyBatch) && !session.validationPreview && (
        <div className="space-y-3">
          <div
            className="rounded-2xl border-2 border-dashed border-ig-border bg-ig-secondary px-4 py-12 text-center"
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              uploadSessionStore.handleFileSelection(event.dataTransfer.files);
            }}
          >
            <p className="text-3xl">🚀</p>
            <p className="mt-3 text-lg font-semibold text-ig-text">Arraste seus vídeos aqui</p>
            <button
              type="button"
              onClick={() => uploadSessionStore.openFilePicker()}
              className="ig-btn-secondary mt-3 inline-flex items-center gap-2 px-5 py-2.5 text-sm font-semibold"
            >
              <Upload size={16} />
              Selecionar vídeos
            </button>
            <p className="mt-4 text-xs text-ig-muted">
              MP4, MOV, WEBM · até {maxUploadLabel} por vídeo · máx. {MAX_VIDEOS_PER_BATCH} por lote
            </p>
          </div>
          <SpeedModePicker
            speedMode={session.speedMode}
            speedPresets={speedPresets}
            running={session.running}
            batchFileCount={batchFileCount}
            onChange={(mode) => uploadSessionStore.setSpeedMode(mode)}
          />
        </div>
      )}

      {session.batch && session.batch.status !== "ready" && !session.validationPreview && !view.isEmptyBatch && (
        <SpeedModePicker
          speedMode={session.speedMode}
          speedPresets={speedPresets}
          running={session.running}
          batchFileCount={batchFileCount}
          onChange={(mode) => uploadSessionStore.setSpeedMode(mode)}
        />
      )}

      {session.validationPreview && (
        <div className="rounded-2xl border border-ig-border bg-ig-elevated p-5">
          <p className="text-lg font-semibold text-ig-text">
            {session.validationPreview.validCount + session.validationPreview.duplicates.length} arquivos
            selecionados
          </p>
          {(() => {
            const count =
              session.validationPreview.validCount + session.validationPreview.duplicates.length;
            const warning = largeBatchAdaptiveMessage(count) ?? largeBatchWarning(count);
            const recommended = recommendSpeedModeForBatch(count);
            if (!warning) return null;
            return (
              <p className="mt-2 text-sm text-ig-info">
                {warning}
                {recommended === "adaptive" && session.speedMode === "turbo"
                  ? " Recomendamos Adaptativo ao iniciar."
                  : ""}
              </p>
            );
          })()}
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              className="ig-btn px-4 py-2 text-sm"
              disabled={!session.validationPreview.validCount}
              onClick={() =>
                void uploadSessionStore.handleValidatedUpload(session.validationPreview!.pendingFiles, true)
              }
            >
              Enviar apenas válidos ({session.validationPreview.validCount})
            </button>
            <button
              type="button"
              className="ig-btn-secondary px-4 py-2 text-sm"
              onClick={() => uploadSessionStore.setValidationPreview(null)}
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {session.batch && (
        <>
          {view.isEmptyBatch ? (
            <div className="rounded-2xl border border-ig-border bg-ig-elevated p-5">
              <p className="text-lg font-semibold text-ig-text">Lote vazio</p>
              <p className="mt-1 text-sm text-ig-muted">
                Lote #{session.batch.batch_number} · @{username} — arraste ou selecione os vídeos abaixo para
                iniciar o envio.
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  className="ig-btn inline-flex items-center gap-2 px-4 py-2 text-sm"
                  onClick={() => uploadSessionStore.openFilePicker()}
                >
                  <Upload size={14} /> Selecionar vídeos
                </button>
                <button
                  type="button"
                  className="rounded-lg border border-ig-border px-3 py-2 text-sm text-ig-muted"
                  onClick={() => void uploadSessionStore.cancelBatch()}
                >
                  Descartar lote
                </button>
              </div>
            </div>
          ) : (
          <div className="rounded-2xl border border-ig-info-border bg-ig-info-bg p-5">
            <p className="text-lg font-semibold text-ig-text">
              {showReceivedForSchedule
                ? "Lote recebido"
                : session.batch.status === "ready" || uploadFullyReceived
                ? "Upload concluído"
                : view.isActivelyUploading
                  ? session.recoveringFromStall
                    ? "Recuperando envio…"
                    : session.engineStarting
                      ? "Preparando envio…"
                      : "Enviando…"
                  : hasFileRetry || session.retrying
                    ? session.message ?? "Tentando enviar novamente…"
                    : view.canResume
                      ? "Upload pausado pelo usuário."
                      : view.awaitingAutoRecovery
                        ? session.message ?? "Recuperando envio…"
                        : view.failedCount > 0
                          ? `${view.failedCount} vídeo(s) com erro`
                          : "Upload em andamento"}
            </p>
            <p className="mt-1 text-sm font-medium text-ig-text">
              {showReceivedForSchedule
                ? `${view.completedCount || view.totalCount} vídeos enviados com sucesso`
                : view.headlineText}
            </p>
            {showReceivedForSchedule && (
              <p className="mt-1 text-sm text-ig-muted">{scheduleProcessingLabel}</p>
            )}
            {!showReceivedForSchedule && (
              <p className="mt-1 text-sm text-ig-muted">
                {view.statusCounterText} · Lote #{session.batch.batch_number} · @{username}
              </p>
            )}
            {view.bytesSummaryText !== "—" && (
              <p className="mt-1 text-sm text-ig-muted">{view.bytesSummaryText}</p>
            )}
            {(session.batchHealthMessage || view.batchStalled || session.recoveringFromStall) && (
              <p className="mt-2 text-sm text-ig-info">
                {session.recoveringFromStall || view.batchStalled
                  ? "Retomando envio automaticamente…"
                  : session.batchHealthMessage}
              </p>
            )}
            {(session.safeMode ||
              session.concurrencyReduced ||
              session.speedMode === "adaptive" ||
              session.adaptiveStability !== "stable") &&
              session.batch.status !== "ready" && (
                <div className="mt-3 rounded-xl border border-ig-info-border bg-ig-info-bg px-4 py-3 text-sm">
                  <p className="font-medium text-ig-text">
                    Modo atual:{" "}
                    {session.speedMode === "adaptive"
                      ? "Adaptativo"
                      : speedPresets[session.speedMode].label}{" "}
                    · {session.effectiveConcurrency} simultâneos
                  </p>
                  {session.adaptiveStability !== "stable" && (
                    <p className="mt-1 text-ig-muted">
                      Status:{" "}
                      {session.safeMode
                        ? "modo seguro"
                        : session.adaptiveStability === "unstable"
                          ? "instável"
                          : session.adaptiveStability === "degraded"
                            ? "degradado"
                            : session.adaptiveStability}
                    </p>
                  )}
                  {session.adaptiveActionMessage && (
                    <p className="mt-1 text-ig-info">{session.adaptiveActionMessage}</p>
                  )}
                  {session.adaptiveReason && (
                    <p className="mt-1 text-xs text-ig-muted">Motivo: {session.adaptiveReason}</p>
                  )}
                  {session.safeMode && (
                    <p className="mt-1 text-ig-info">
                      Muitos erros detectados. Modo seguro ativo para continuar com estabilidade.
                    </p>
                  )}
                </div>
              )}
            {session.batch.status !== "ready" && !showReceivedForSchedule && (
              <>
                <div className="mt-4 h-2 overflow-hidden rounded-full bg-ig-secondary">
                  <div
                    className="h-full rounded-full bg-ig-primary"
                    style={{ width: `${view.overallPercent}%` }}
                  />
                </div>
                {(session.progress && view.isActivelyUploading) || view.stats.hasActiveUploads ? (
                  <div className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
                    <p className="text-ig-muted">{view.speedSummaryText}</p>
                    <p className="text-ig-muted">
                      Restante:{" "}
                      <span className="text-ig-text">{view.etaSummaryText}</span>
                    </p>
                  </div>
                ) : null}
              </>
            )}
            <div className="mt-4 flex flex-wrap gap-2">
              {showUploadCompletionActions ? (
                <BatchCompletionActions
                  platform={platform}
                  accountId={accountId}
                  batchId={session.batch?.id}
                  onStartNewBatch={handleStartNewBatch}
                />
              ) : uploadReadyForAiSchedule && onScheduleAll ? (
                <div className="w-full space-y-3">
                  <p className="text-sm text-ig-muted">
                    Upload concluído. A IA cria legendas e agenda suas publicações automaticamente.
                  </p>
                  <button
                    type="button"
                    className="ig-btn w-full px-4 py-3 text-sm font-bold disabled:opacity-50"
                    disabled={!canScheduleAll || scheduleAllBusy}
                    onClick={onScheduleAll}
                  >
                    {scheduleAllBusy
                      ? "Processando..."
                      : canScheduleAll
                        ? "🚀 DEIXAR A IA PROGRAMAR TUDO"
                        : "Aguardando upload..."}
                  </button>
                </div>
              ) : (
                <>
                  {(session.running || session.engineStarting) && (
                    <button
                      type="button"
                      className="ig-btn-secondary inline-flex items-center gap-2 px-3 py-2 text-sm"
                      onClick={() => void uploadSessionStore.togglePause()}
                    >
                      <Pause size={14} /> Pausar
                    </button>
                  )}
                  {view.canResume && !session.running && (
                    <button
                      type="button"
                      className="ig-btn inline-flex items-center gap-2 px-4 py-2 text-sm"
                      disabled={session.resuming}
                      onClick={() => void uploadSessionStore.resumePausedUpload()}
                    >
                      <Play size={14} /> {resumeButtonLabel()}
                    </button>
                  )}
                  {view.canAddVideosToBatch && !view.isEmptyBatch && !session.running && (
                    <button
                      type="button"
                      className="ig-btn inline-flex items-center gap-2 px-4 py-2 text-sm"
                      disabled={session.resuming}
                      onClick={() => uploadSessionStore.openChooseVideos()}
                    >
                      <Upload size={14} /> Selecionar arquivos
                    </button>
                  )}
                  {view.showRecoverButton && (
                    <button
                      type="button"
                      className="ig-btn inline-flex items-center gap-2 px-4 py-2 text-sm"
                      disabled={session.resuming || session.recoveringFromStall}
                      onClick={() => void uploadSessionStore.recoverBatchUpload("manual_recover")}
                    >
                      Recuperar upload
                    </button>
                  )}
                  {view.canRetryFailed && (
                    <button
                      type="button"
                      className="ig-btn inline-flex items-center gap-2 px-4 py-2 text-sm"
                      disabled={session.resuming}
                      onClick={() => void uploadSessionStore.retryAllFailedFiles()}
                    >
                      Tentar novamente arquivos com erro
                    </button>
                  )}
                  {view.completedCount > 0 &&
                    onSchedulePartial &&
                    !session.running &&
                    view.completedCount < view.totalCount && (
                    <button type="button" className="ig-btn-secondary px-3 py-2 text-sm" onClick={onSchedulePartial}>
                      Agendar vídeos enviados
                    </button>
                  )}
                  {!batchTerminal && !uploadFullyReceived && !showReceivedForSchedule && (
                    <button
                      type="button"
                      className="rounded-lg border border-ig-border px-3 py-2 text-sm text-ig-muted"
                      onClick={() => void uploadSessionStore.cancelBatch()}
                    >
                      Cancelar lote
                    </button>
                  )}
                </>
              )}
            </div>
          </div>
          )}

          {!view.isEmptyBatch && (
          <div className="rounded-xl border border-ig-border bg-ig-elevated p-4">
            <p className="mb-3 text-sm font-medium text-ig-text">Status por vídeo</p>
            <div className="max-h-80 space-y-2 overflow-y-auto pr-1">
              {view.listFiles.map((file) => (
                <FileStatusRow
                  key={file.id}
                  file={file}
                  percent={getFileDisplayPercent(file, session.progressMap)}
                  maxUploadBytes={maxUploadBytes}
                  isStalled={session.fileRuntime[file.id]?.status === "stalled"}
                  isRetrying={
                    file.status === "retrying" ||
                    session.fileRuntime[file.id]?.status === "retrying"
                  }
                  runtimeStatus={session.fileRuntime[file.id]?.status}
                  onRetry={(record) => uploadSessionStore.retryFile(record)}
                />
              ))}
              {view.pendingCount >
                view.listFiles.filter((file) => file.status !== "completed").length && (
                <p className="pt-1 text-center text-xs text-ig-muted">
                  +
                  {view.pendingCount -
                    view.listFiles.filter((file) => file.status !== "completed").length}{" "}
                  vídeos na fila
                </p>
              )}
            </div>
          </div>
          )}
        </>
      )}

      {(view.isActivelyUploading || session.resuming || session.retrying || hasFileRetry) && (
        <div className="flex items-center gap-2 text-sm text-ig-primary">
          <Loader2 size={16} className="animate-spin" />
          {view.isActivelyUploading
            ? session.recoveringFromStall || session.batchStalled
              ? "Recuperando envio…"
              : `Enviando (${speedPresets[session.speedMode].label})…`
            : hasFileRetry || session.retrying
              ? session.message ?? "Tentando enviar novamente…"
              : session.resuming
                ? "Reconhecendo arquivos..."
                : `Enviando (${speedPresets[session.speedMode].label})…`}
        </div>
      )}

      {session.concurrencyReduced && (
        <p className="text-xs text-amber-600 dark:text-amber-400">
          Reduzimos a velocidade para proteger o envio do lote.
        </p>
      )}

      {session.message &&
        !hasFileRetry &&
        !session.retrying &&
        batchStatus !== "scheduled" &&
        batchStatus !== "cancelled" && (
        <p
          className={`text-sm ${session.message.includes("Erro") || session.message.includes("Falha") || session.message.includes("falhou") ? "text-ig-danger" : "text-ig-text"}`}
        >
          {session.message}
        </p>
      )}
    </div>
  );
}

function SpeedModePicker({
  speedMode,
  speedPresets,
  running,
  batchFileCount,
  onChange,
}: {
  speedMode: UploadSpeedMode;
  speedPresets: ReturnType<typeof getSpeedPresets>;
  running: boolean;
  batchFileCount: number;
  onChange: (mode: UploadSpeedMode) => void;
}) {
  const modes: UploadSpeedMode[] = ["adaptive", "normal", "economy"];

  const handleChange = (mode: UploadSpeedMode) => {
    if (mode === "turbo" && batchFileCount > 300) {
      if (!window.confirm(turboLargeBatchConfirmMessage(batchFileCount))) {
        return;
      }
    }
    onChange(mode);
  };

  return (
    <div>
      <p className="mb-2 text-sm font-medium text-ig-text">Velocidade de upload</p>
      <div className="flex flex-wrap gap-2">
        {modes.map((mode) => (
          <button
            key={mode}
            type="button"
            onClick={() => handleChange(mode)}
            className={`rounded-full px-4 py-2 text-sm ${
              speedMode === mode
                ? "bg-ig-primary text-ig-on-primary"
                : "border border-ig-border bg-ig-secondary text-ig-text"
            }`}
          >
            {speedPresets[mode].label}
            {mode !== "adaptive" ? ` · ${speedPresets[mode].fileConcurrency}` : ""}
          </button>
        ))}
      </div>
      <p className="mt-1 text-xs text-ig-muted">
        {speedPresets[speedMode].description}
        {batchFileCount > 150 && speedMode !== "adaptive"
          ? " · Lote grande: Adaptativo recomendado."
          : ""}
        {running ? " · pode trocar durante o envio" : ""}
      </p>
    </div>
  );
}

export { getCompletedUploadItems };
