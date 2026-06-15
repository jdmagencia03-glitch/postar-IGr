import type { PostStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

const styles: Record<PostStatus, string> = {
  pending: "bg-amber-500/20 text-ig-warning",
  processing: "bg-blue-500/20 text-ig-link",
  published: "bg-emerald-500/20 text-ig-success",
  failed: "bg-red-500/20 text-ig-danger",
};

const labels: Record<PostStatus, string> = {
  pending: "Pendente",
  processing: "Publicando",
  published: "Publicado",
  failed: "Falhou",
};

export function StatusBadge({ status }: { status: PostStatus }) {
  return (
    <span className={cn("rounded-full px-2.5 py-1 text-xs font-medium", styles[status])}>
      {labels[status]}
    </span>
  );
}
