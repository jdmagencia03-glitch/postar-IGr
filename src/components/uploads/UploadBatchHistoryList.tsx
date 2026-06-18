"use client";

import Link from "next/link";
import { formatShortDateTime } from "@/lib/operations/compute";
import type { UploadBatch } from "@/lib/types";

function batchLabel(batch: UploadBatch) {
  if (batch.platform === "tiktok") {
    return batch.tiktok_accounts?.username ?? batch.tiktok_accounts?.display_name ?? "TikTok";
  }
  return batch.instagram_accounts?.ig_username ? `@${batch.instagram_accounts.ig_username}` : "Instagram";
}

function batchStatusLabel(batch: UploadBatch) {
  if (batch.status === "uploading") return "Enviando";
  if (batch.status === "ready") return "Pronto para agendar";
  if (batch.status === "scheduling") return "Agendando";
  if (batch.status === "scheduled") return "Agendado";
  if (batch.status === "cancelled") return "Cancelado";
  return batch.status;
}

function durationLabel(batch: UploadBatch) {
  if (!batch.started_at) return "—";
  const end = batch.finished_at ? new Date(batch.finished_at).getTime() : Date.now();
  const minutes = Math.max(1, Math.round((end - new Date(batch.started_at).getTime()) / 60_000));
  return `${minutes} min`;
}

export function UploadBatchHistoryList({ batches }: { batches: UploadBatch[] }) {
  if (!batches.length) {
    return (
      <div className="rounded-2xl border border-dashed border-ig-border p-12 text-center text-ig-muted">
        Nenhum lote de upload registrado ainda.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {batches.map((batch) => {
        const pending = Math.max(
          0,
          batch.total_files - batch.completed_files - batch.failed_files,
        );
        const partial = batch.failed_files > 0 && batch.completed_files > 0;

        return (
          <article
            key={batch.id}
            className="rounded-2xl border border-ig-border bg-ig-elevated p-5"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-ig-muted">
                  Lote #{batch.batch_number ?? "—"}
                </p>
                <h3 className="mt-1 text-lg font-semibold text-ig-text">{batchLabel(batch)}</h3>
                <p className="mt-1 text-sm text-ig-muted">
                  {batch.platform === "tiktok" ? "TikTok" : "Instagram"} ·{" "}
                  {batchStatusLabel(batch)}
                  {partial ? " · parcialmente concluído" : ""}
                </p>
              </div>
              <p className="text-xs text-ig-muted">
                {batch.started_at ? formatShortDateTime(batch.started_at) : formatShortDateTime(batch.created_at)}
              </p>
            </div>

            <dl className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-5">
              <div>
                <dt className="text-ig-muted">Total</dt>
                <dd className="font-semibold text-ig-text">{batch.total_files}</dd>
              </div>
              <div>
                <dt className="text-ig-muted">Concluídos</dt>
                <dd className="font-semibold text-emerald-600">{batch.completed_files}</dd>
              </div>
              <div>
                <dt className="text-ig-muted">Falharam</dt>
                <dd className="font-semibold text-ig-danger">{batch.failed_files}</dd>
              </div>
              <div>
                <dt className="text-ig-muted">Pendentes</dt>
                <dd className="font-semibold text-ig-text">{pending}</dd>
              </div>
              <div>
                <dt className="text-ig-muted">Duração</dt>
                <dd className="font-semibold text-ig-text">{durationLabel(batch)}</dd>
              </div>
            </dl>

            <div className="mt-4 flex flex-wrap gap-2">
              <Link
                href={`/dashboard/uploads/${batch.id}`}
                className="rounded-lg border border-ig-border px-4 py-2 text-sm font-medium hover:bg-ig-secondary"
              >
                Ver detalhe
              </Link>
              {(batch.status === "uploading" || batch.status === "ready") && (
                <Link href="/dashboard/bulk" className="ig-btn-secondary px-4 py-2 text-sm">
                  {batch.status === "ready" ? "Agendar vídeos" : "Retomar upload"}
                </Link>
              )}
              {batch.failed_files > 0 && (
                <Link href="/dashboard/bulk" className="rounded-lg border border-ig-border px-4 py-2 text-sm">
                  Tentar falhados
                </Link>
              )}
            </div>
          </article>
        );
      })}
    </div>
  );
}
