import { redirect } from "next/navigation";
import { format, parseISO, startOfMonth, endOfMonth, eachDayOfInterval, isSameDay } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Navbar } from "@/components/Navbar";
import { StatusBadge } from "@/components/StatusBadge";
import { getOwnerAccounts } from "@/lib/accounts";
import { getSessionUserId } from "@/lib/meta/oauth";
import { createAdminClient } from "@/lib/supabase/admin";
import type { ScheduledPost } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function CalendarPage() {
  const ownerId = await getSessionUserId();
  if (!ownerId) redirect("/login?next=/dashboard/calendar");

  const supabase = createAdminClient();
  const accounts = await getOwnerAccounts(supabase, ownerId);
  const accountIds = accounts.map((a) => a.id);

  const { data: posts } = await supabase
    .from("scheduled_posts")
    .select("*")
    .in("account_id", accountIds)
    .order("scheduled_at", { ascending: true });

  const now = new Date();
  const days = eachDayOfInterval({
    start: startOfMonth(now),
    end: endOfMonth(now),
  });

  const typedPosts = (posts ?? []) as ScheduledPost[];

  return (
    <div>
      <Navbar />
      <main className="mx-auto max-w-6xl px-4 py-8">
        <h1 className="mb-2 text-2xl font-bold text-white">Calendário</h1>
        <p className="mb-8 text-zinc-400">
          {format(now, "MMMM yyyy", { locale: ptBR })}
        </p>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {days.map((day) => {
            const dayPosts = typedPosts.filter((p) =>
              isSameDay(parseISO(p.scheduled_at), day),
            );

            return (
              <div
                key={day.toISOString()}
                className="min-h-28 rounded-xl border border-white/10 bg-white/5 p-3"
              >
                <p className="mb-2 text-sm font-medium text-white">
                  {format(day, "dd/MM")}
                </p>
                {dayPosts.length === 0 ? (
                  <p className="text-xs text-zinc-500">—</p>
                ) : (
                  <div className="space-y-1">
                    {dayPosts.slice(0, 3).map((p) => (
                      <div key={p.id} className="flex items-center justify-between gap-2">
                        <span className="text-xs text-zinc-400">
                          {format(parseISO(p.scheduled_at), "HH:mm")}
                        </span>
                        <StatusBadge status={p.status} />
                      </div>
                    ))}
                    {dayPosts.length > 3 && (
                      <p className="text-xs text-zinc-500">+{dayPosts.length - 3} mais</p>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </main>
    </div>
  );
}
