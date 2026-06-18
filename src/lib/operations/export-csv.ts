import { CONTENT_TYPE_LABELS } from "@/lib/content-types";
import { getPostAccountUsername } from "@/lib/posts";
import type { ScheduledPost } from "@/lib/types";

export interface CsvExportRow {
  account: string;
  platform: string;
  type: string;
  status: string;
  scheduledAt: string;
  publishedAt: string;
  error: string;
  attempts: number;
  permalink: string;
}

export function postsToCsvRows(posts: ScheduledPost[]): CsvExportRow[] {
  return posts.map((post) => ({
    account: getPostAccountUsername(post),
    platform: post.platform ?? "instagram",
    type: CONTENT_TYPE_LABELS[(post.content_type ?? "reel") as keyof typeof CONTENT_TYPE_LABELS],
    status: post.status,
    scheduledAt: post.scheduled_at,
    publishedAt: post.published_at ?? "",
    error: post.error_message ?? "",
    attempts: post.retry_count ?? 0,
    permalink: post.permalink ?? "",
  }));
}

export function csvRowsToString(rows: CsvExportRow[]) {
  const headers = [
    "Conta",
    "Plataforma",
    "Tipo",
    "Status",
    "Horário agendado",
    "Publicado em",
    "Erro",
    "Tentativas",
    "Link publicado",
  ];

  const escape = (value: string) => `"${value.replace(/"/g, '""')}"`;

  const lines = [
    headers.join(","),
    ...rows.map((row) =>
      [
        row.account,
        row.platform,
        row.type,
        row.status,
        row.scheduledAt,
        row.publishedAt,
        row.error,
        String(row.attempts),
        row.permalink,
      ]
        .map(escape)
        .join(","),
    ),
  ];

  return lines.join("\n");
}

export function downloadCsv(filename: string, content: string) {
  const blob = new Blob(["\uFEFF" + content], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
