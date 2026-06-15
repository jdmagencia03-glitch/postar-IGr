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
    info: "text-blue-300",
    success: "text-emerald-300",
    error: "text-red-300",
  };

  return (
    <div>
      <Navbar />
      <main className="mx-auto max-w-4xl px-4 py-8">
        <h1 className="mb-2 text-2xl font-bold text-white">Logs de publicação</h1>
        <p className="mb-8 text-zinc-400">Histórico de tentativas e resultados.</p>

        <div className="space-y-3">
          {logs?.map((log) => (
            <div
              key={log.id}
              className="rounded-xl border border-white/10 bg-white/5 p-4"
            >
              <div className="mb-1 flex items-center justify-between">
                <span
                  className={`text-xs font-medium uppercase ${levelColors[log.level as keyof typeof levelColors]}`}
                >
                  {log.level}
                </span>
                <span className="text-xs text-zinc-500">
                  {formatDateTime(log.created_at)}
                </span>
              </div>
              <p className="text-sm text-zinc-300">{log.message}</p>
            </div>
          ))}

          {!logs?.length && (
            <p className="text-center text-zinc-500">Nenhum log ainda.</p>
          )}
        </div>
      </main>
    </div>
  );
}
