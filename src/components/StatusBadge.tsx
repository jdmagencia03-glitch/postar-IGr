import type { PostStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

const styles: Record<PostStatus, string> = {
  pending: "bg-ig-secondary text-ig-muted",
  processing: "bg-ig-primary/15 text-ig-link",
  published: "bg-ig-secondary text-ig-text",
  failed: "bg-ig-danger/15 text-ig-danger",
};

const labels: Record<PostStatus, string> = {
  pending: "Pendente",
  processing: "Publicando",
  published: "Publicado",
  failed: "Falhou",
};

export function StatusBadge({
  status,
  onPrimary = false,
}: {
  status: PostStatus;
  onPrimary?: boolean;
}) {
  return (
    <span
      className={cn(
        "rounded-full px-2.5 py-1 text-xs font-medium",
        onPrimary ? "bg-white/20 text-ig-on-primary" : styles[status],
      )}
    >
      {labels[status]}
    </span>
  );
}
