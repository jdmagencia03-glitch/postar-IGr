import Link from "next/link";
import { CalendarDays, Upload } from "lucide-react";
import { PostsManager } from "@/components/PostsManager";
import type { ScheduledPost } from "@/lib/types";

interface Props {
  posts: ScheduledPost[];
  allPosts: ScheduledPost[];
}

export function DashboardNextPostsPanel({ posts, allPosts }: Props) {
  const hasPosts = allPosts.length > 0;

  return (
    <div className="ig-panel flex h-full min-h-[220px] flex-col overflow-hidden">
      <div className="flex items-center justify-between gap-2 border-b border-ig-border px-5 py-4">
        <h2 className="text-sm font-semibold text-ig-text">Próximos posts</h2>
        {hasPosts && (
          <Link href="/dashboard/reports" className="text-xs font-medium text-ig-primary hover:underline">
            Ver operações
          </Link>
        )}
      </div>

      {!hasPosts ? (
        <div className="flex flex-1 flex-col items-center justify-center px-6 py-10 text-center">
          <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-ig-info-bg text-ig-primary">
            <CalendarDays size={32} strokeWidth={1.5} />
          </div>
          <p className="max-w-xs text-sm leading-relaxed text-ig-muted">
            Nenhum post agendado ainda. Envie seus vídeos e comece a agendar para as próximas
            datas.
          </p>
          <Link href="/dashboard/bulk" className="ig-btn mt-5 inline-flex items-center gap-2 px-5 py-2.5 text-sm">
            <Upload size={16} />
            Enviar vídeos
          </Link>
        </div>
      ) : (
        <div className="flex-1 p-4">
          <PostsManager posts={posts} bulkScopePosts={allPosts} enableBulk />
        </div>
      )}
    </div>
  );
}
