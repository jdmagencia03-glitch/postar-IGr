import Link from "next/link";
import { ExternalLink } from "lucide-react";

interface Props {
  fileName: string;
  fileSize: string;
  percent: number;
  completedCount: number;
  totalCount: number;
  batchNumber: number;
}

/** Versão estática para /preview (sem sessão de upload). */
export function DashboardUploadCardPreview({
  fileName,
  fileSize,
  percent,
  completedCount,
  totalCount,
  batchNumber,
}: Props) {
  return (
    <div className="ig-panel flex h-full min-h-[220px] flex-col p-5">
      <div className="mb-4 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-ig-text">Upload em andamento</h2>
        <Link
          href="/dashboard/bulk"
          className="inline-flex items-center gap-1 text-xs font-medium text-ig-primary hover:underline"
        >
          Ver upload
          <ExternalLink size={12} />
        </Link>
      </div>

      <div className="flex-1 rounded-xl border border-ig-border bg-ig-secondary/40 p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-ig-text">{fileName}</p>
            <p className="mt-1 text-xs text-ig-muted">
              Tamanho: {fileSize} · {percent}% concluído
            </p>
          </div>
          <span className="shrink-0 rounded-md bg-ig-primary/15 px-2 py-0.5 text-[10px] font-bold tracking-wide text-ig-primary">
            ENVIANDO
          </span>
        </div>

        <div className="mt-4 h-2.5 overflow-hidden rounded-full bg-ig-elevated">
          <div
            className="h-full rounded-full bg-ig-primary"
            style={{ width: `${percent}%` }}
          />
        </div>

        <p className="mt-3 text-xs text-ig-muted">
          {completedCount} de {totalCount} vídeos · Lote #{batchNumber}
        </p>
      </div>
    </div>
  );
}
