"use client";

import { csvRowsToString, downloadCsv, postsToCsvRows } from "@/lib/operations/export-csv";
import type { ScheduledPost } from "@/lib/types";

interface Props {
  posts: ScheduledPost[];
  disabled?: boolean;
}

export function ExportReportButton({ posts, disabled = false }: Props) {
  function handleExport() {
    const rows = postsToCsvRows(posts);
    const csv = csvRowsToString(rows);
    const date = new Date().toISOString().slice(0, 10);
    downloadCsv(`relatorio-publicacoes-${date}.csv`, csv);
  }

  if (disabled) {
    return (
      <button
        type="button"
        disabled
        title="Em breve"
        className="rounded-lg border border-ig-border px-3 py-2 text-sm text-ig-muted opacity-60"
      >
        Exportar CSV (em breve)
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={handleExport}
      className="rounded-lg border border-ig-border px-3 py-2 text-sm hover:bg-ig-secondary"
    >
      Exportar CSV
    </button>
  );
}
