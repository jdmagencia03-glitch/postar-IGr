import { formatShortDateTime } from "@/lib/operations/compute";
import type { PublishLog, ScheduledPost } from "@/lib/types";

export type TimelineEventTone = "info" | "success" | "error" | "warning";

export interface PostTimelineEvent {
  id: string;
  at: string;
  label: string;
  detail?: string;
  tone: TimelineEventTone;
  source: "post" | "log" | "system";
}

function pushEvent(
  events: PostTimelineEvent[],
  params: Omit<PostTimelineEvent, "id"> & { id?: string },
) {
  events.push({
    id: params.id ?? `${params.at}-${params.label}`,
    ...params,
  });
}

export function buildPostTimeline(
  post: ScheduledPost,
  logs: PublishLog[] = [],
): PostTimelineEvent[] {
  const events: PostTimelineEvent[] = [];

  pushEvent(events, {
    at: post.created_at,
    label: "Post criado",
    tone: "info",
    source: "post",
  });

  if (post.caption) {
    pushEvent(events, {
      at: post.created_at,
      label: "Legenda definida",
      detail: post.caption.slice(0, 80) + (post.caption.length > 80 ? "…" : ""),
      tone: "info",
      source: "system",
    });
  }

  pushEvent(events, {
    at: post.scheduled_at,
    label: "Agendado para publicação",
    detail: formatShortDateTime(post.scheduled_at),
    tone: "info",
    source: "post",
  });

  if (post.status === "processing" || post.status === "published" || post.status === "failed" || post.status === "retrying" || post.status === "failed_persistent") {
    pushEvent(events, {
      at: post.scheduled_at,
      label: "Enviado para publicação",
      tone: "info",
      source: "system",
    });
  }

  for (const log of [...logs].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
  )) {
    const tone: TimelineEventTone =
      log.level === "success" ? "success" : log.level === "error" ? "error" : "info";

    pushEvent(events, {
      id: log.id,
      at: log.created_at,
      label: log.message,
      tone,
      source: "log",
    });
  }

  if (post.status === "retrying" && post.next_retry_at) {
    pushEvent(events, {
      at: post.next_retry_at,
      label: `Retry agendado (tentativa ${(post.retry_count ?? 0) + 1})`,
      detail: formatShortDateTime(post.next_retry_at),
      tone: "warning",
      source: "system",
    });
  }

  if (post.status === "failed_persistent") {
    pushEvent(events, {
      at: post.scheduled_at,
      label: "Retry esgotado — falha persistente",
      detail: post.error_message ?? undefined,
      tone: "error",
      source: "system",
    });
  }

  if (post.status === "published" && post.published_at) {
    const hasSuccessLog = logs.some((l) => l.level === "success");
    if (!hasSuccessLog) {
      pushEvent(events, {
        at: post.published_at,
        label: "Publicado com sucesso",
        detail: post.permalink ?? undefined,
        tone: "success",
        source: "post",
      });
    }
  }

  if (post.status === "cancelled") {
    pushEvent(events, {
      at: post.scheduled_at,
      label: "Publicação cancelada",
      tone: "warning",
      source: "system",
    });
  }

  if (post.error_message && post.status !== "failed_persistent") {
    const hasErrorLog = logs.some((l) => l.level === "error");
    if (!hasErrorLog) {
      pushEvent(events, {
        at: post.scheduled_at,
        label: "Falhou",
        detail: post.error_message,
        tone: "error",
        source: "post",
      });
    }
  }

  return events.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
}

export function inferOperationalEventType(message: string) {
  const lower = message.toLowerCase();
  if (lower.includes("criad")) return "publication_created";
  if (lower.includes("editad") || lower.includes("legenda")) return "publication_edited";
  if (lower.includes("cancelad")) return "publication_cancelled";
  if (lower.includes("publicad") && lower.includes("sucesso")) return "publication_published";
  if (lower.includes("falh") || lower.includes("erro")) return "publication_failed";
  if (lower.includes("retry") && lower.includes("agendad")) return "retry_scheduled";
  if (lower.includes("retry") && lower.includes("iniciad")) return "retry_started";
  if (lower.includes("retry") && lower.includes("esgotad")) return "retry_exhausted";
  if (lower.includes("pausad")) return "account_paused";
  if (lower.includes("retomad")) return "account_resumed";
  if (lower.includes("upload")) return "upload";
  return "other";
}

export function operationalEventLabel(type: string) {
  const labels: Record<string, string> = {
    publication_created: "Publicação criada",
    publication_edited: "Publicação editada",
    publication_cancelled: "Publicação cancelada",
    publication_published: "Publicação publicada",
    publication_failed: "Publicação falhou",
    retry_scheduled: "Retry agendado",
    retry_started: "Retry iniciado",
    retry_exhausted: "Retry esgotado",
    account_paused: "Conta pausada",
    account_resumed: "Conta retomada",
    upload: "Upload",
    other: "Evento",
  };
  return labels[type] ?? "Evento";
}
