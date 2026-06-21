"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Download, RefreshCw } from "lucide-react";
import { formatShortDateTime } from "@/lib/operations/compute";
import { getUploadBatchStats } from "@/lib/upload/batch-stats";
import type { UploadBatch, UploadBatchFile } from "@/lib/types";

function fileStatusLabel(status: UploadBatchFile["status"]) {
  if (status === "completed") return "Concluído";
  if (status === "failed") return "Falhou";
  if (status === "uploading") return "Enviando";
  return "Pendente";
}

function durationLabel(batch: UploadBatch) {
  if (!batch.started_at) return "—";
  const end = batch.finished_at ? new Date(batch.finished_at).getTime() : Date.now();
  const minutes = Math.max(1, Math.round((end - new Date(batch.started_at).getTime()) / 60_000));
  return `${minutes} min`;
}

function exportCsv(batch: UploadBatch, files: UploadBatchFile[]) {
  const rows = [
    ["filename", "status", "error", "url"],
    ...files.map((file) => [
      file.filename,
      file.status,
      file.error_message ?? "",
      file.public_url ?? "",
    ]),
  ];
  const csv = rows.map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `lote-${batch.batch_number ?? batch.id.slice(0, 8)}.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function UploadBatchDetailView({ batch }: { batch: UploadBatch & { upload_files: UploadBatchFile[] } }) {
  const router = useRouter();
  const files = batch.upload_files ?? [];
  const stats = getUploadBatchStats(batch, { monotonic: false });
  const failedFiles = files.filter((f) => f.status === "failed");
  const completedFiles = files.filter((f) => f.status === "completed");

  const accountLabel =
    batch.platform === "tiktok"
      ? batch.tiktok_accounts?.username ?? batch.tiktok_accounts?.display_name ?? "TikTok"
      : batch.instagram_accounts?.ig_username
        ? `@${batch.instagram_accounts.ig_username}`
        : "Instagram";

  async function retryFailed() {
    if (!failedFiles.length) return;
    for (const file of failedFiles) {
      await fetch(`/api/upload/batches/${batch.id}/files/${file.id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "pending", error_message: null }),
      });
    }
    router.refresh();
  }

  return (
    <div className="space-y-6">
      <Link href="/dashboard/uploads" className="text-sm text-ig-primary hover:underline">
        ← Voltar ao histórico
      </Link>

      <header className="rounded-2xl border border-ig-border bg-ig-elevated p-5">
        <p className="text-xs uppercase tracking-wide text-ig-muted">Lote #{batch.batch_number ?? "—"}</p>
        <h1 className="mt-1 text-2xl font-bold">{accountLabel}</h1>
        <p className="mt-1 text-sm text-ig-muted">
          ID: <span className="font-mono text-xs">{batch.id}</span>
        </p>
        <dl className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4 lg:grid-cols-6">
          <div>
            <dt className="text-ig-muted">Início</dt>
            <dd className="font-semibold">{batch.started_at ? formatShortDateTime(batch.started_at) : "—"}</dd>
          </div>
          <div>
            <dt className="text-ig-muted">Fim</dt>
            <dd className="font-semibold">{batch.finished_at ? formatShortDateTime(batch.finished_at) : "—"}</dd>
          </div>
          <div>
            <dt className="text-ig-muted">Total</dt>
            <dd className="font-semibold">{stats.totalFiles}</dd>
          </div>
          <div>
            <dt className="text-ig-muted">Concluídos</dt>
            <dd className="font-semibold text-emerald-600">{stats.completedFiles}</dd>
          </div>
          <div>
            <dt className="text-ig-muted">Falharam</dt>
            <dd className="font-semibold text-ig-danger">{stats.failedFiles}</dd>
          </div>
          <div>
            <dt className="text-ig-muted">Pendentes</dt>
            <dd className="font-semibold">{stats.pendingFiles}</dd>
          </div>
          <div>
            <dt className="text-ig-muted">Duração</dt>
            <dd className="font-semibold">{durationLabel(batch)}</dd>
          </div>
        </dl>
        <div className="mt-4 flex flex-wrap gap-2">
          {failedFiles.length > 0 && (
            <button type="button" onClick={() => void retryFailed()} className="inline-flex items-center gap-1 rounded-lg border border-ig-border px-3 py-1.5 text-xs">
              <RefreshCw className="h-3.5 w-3.5" /> Tentar falhados ({failedFiles.length})
            </button>
          )}
          {completedFiles.length > 0 && batch.status !== "scheduled" && (
            <Link href="/dashboard/bulk" className="rounded-lg border border-ig-border px-3 py-1.5 text-xs">
              Agendar enviados
            </Link>
          )}
          <button type="button" onClick={() => exportCsv(batch, files)} className="inline-flex items-center gap-1 rounded-lg border border-ig-border px-3 py-1.5 text-xs">
            <Download className="h-3.5 w-3.5" /> Exportar CSV
          </button>
        </div>
      </header>

      <section className="rounded-2xl border border-ig-border bg-ig-elevated p-5">
        <h2 className="text-lg font-semibold">Arquivos ({files.length})</h2>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead>
              <tr className="border-b border-ig-border text-xs text-ig-muted">
                <th className="py-2 pr-3">Arquivo</th>
                <th className="py-2 pr-3">Status</th>
                <th className="py-2">Erro</th>
              </tr>
            </thead>
            <tbody>
              {files.map((file) => (
                <tr key={file.id} className="border-b border-ig-border/60">
                  <td className="py-2 pr-3 font-medium">{file.filename}</td>
                  <td className="py-2 pr-3">{fileStatusLabel(file.status)}</td>
                  <td className="py-2 text-xs text-ig-danger">{file.error_message ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
