import type { PostStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

const styles: Record<PostStatus, string> = {
  pending: "bg-amber-500/20 text-amber-300",
  processing: "bg-blue-500/20 text-blue-300",
  published: "bg-emerald-500/20 text-emerald-300",
  failed: "bg-red-500/20 text-red-300",
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
