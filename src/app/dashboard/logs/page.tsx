import { redirect } from "next/navigation";
import { Navbar } from "@/components/Navbar";
import { formatDateTime } from "@/lib/utils";
import { getOwnerAccounts } from "@/lib/accounts";
import { getSessionUserId } from "@/lib/meta/oauth";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export default async function LogsPage() {
  const ownerId = await getSessionUserId();
  if (!ownerId) redirect("/login?next=/dashboard/logs");

  const supabase = createAdminClient();
  const accounts = await getOwnerAccounts(supabase, ownerId);
  const accountIds = accounts.map((a) => a.id);

  const { data: posts } = await supabase
    .from("scheduled_posts")
    .select("id")
    .in("account_id", accountIds);

  const postIds = posts?.map((p) => p.id) ?? [];

  const { data: logs } = await supabase
    .from("publish_logs")
    .select("*")
    .in("post_id", postIds)
    .order("created_at", { ascending: false })
    .limit(50);

  const levelColors = {
    info: "text-ig-link",
    success: "text-ig-text",
    error: "text-ig-danger",
  };

  return (
    <div>
      <Navbar />
      <main className="mx-auto max-w-4xl px-4 py-8">
        <h1 className="mb-2 text-2xl font-bold text-ig-text">Logs de publicação</h1>
        <p className="mb-8 text-ig-muted">Histórico de tentativas e resultados.</p>

        <div className="space-y-3">
          {logs?.map((log) => (
            <div
              key={log.id}
              className="rounded-xl border border-ig-border bg-ig-secondary p-4"
            >
              <div className="mb-1 flex items-center justify-between">
                <span
                  className={`text-xs font-medium uppercase ${levelColors[log.level as keyof typeof levelColors]}`}
                >
                  {log.level}
                </span>
                <span className="text-xs text-ig-muted">
                  {formatDateTime(log.created_at)}
                </span>
              </div>
              <p className="text-sm text-ig-text">{log.message}</p>
            </div>
          ))}

          {!logs?.length && (
            <p className="text-center text-ig-muted">Nenhum log ainda.</p>
          )}
        </div>
      </main>
    </div>
  );
}
