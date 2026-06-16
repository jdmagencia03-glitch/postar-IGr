import { redirect } from "next/navigation";
import {
  eachDayOfInterval,
  endOfMonth,
  format,
  isBefore,
  isSameDay,
  parseISO,
  startOfDay,
  startOfMonth,
} from "date-fns";
import { ptBR } from "date-fns/locale";
import { Navbar } from "@/components/Navbar";
import { StatusBadge } from "@/components/StatusBadge";
import { getOwnerAccounts } from "@/lib/accounts";
import { getSessionUserId } from "@/lib/meta/oauth";
import { createAdminClient } from "@/lib/supabase/admin";
import type { ScheduledPost } from "@/lib/types";
import { cn } from "@/lib/utils";

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
        <h1 className="mb-2 text-2xl font-bold text-ig-text">Calendário</h1>
        <p className="mb-8 text-ig-muted">
          {format(now, "MMMM yyyy", { locale: ptBR })}
        </p>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {days.map((day) => {
            const dayPosts = typedPosts.filter((p) =>
              isSameDay(parseISO(p.scheduled_at), day),
            );
            const isPastDay = isBefore(startOfDay(day), startOfDay(now));
            const hasPublished = dayPosts.some((post) => post.status === "published");
            const isPublishedDay = isPastDay && hasPublished;

            return (
              <div
                key={day.toISOString()}
                className={cn(
                  "min-h-28 rounded-xl border p-3",
                  isPublishedDay
                    ? "border-ig-primary bg-ig-primary text-ig-on-primary"
                    : "border-ig-border bg-ig-secondary",
                )}
              >
                <p
                  className={cn(
                    "mb-2 text-sm font-medium",
                    isPublishedDay ? "text-ig-on-primary" : "text-ig-text",
                  )}
                >
                  {format(day, "dd/MM")}
                </p>
                {dayPosts.length === 0 ? (
                  <p className={cn("text-xs", isPublishedDay ? "text-ig-on-primary/80" : "text-ig-muted")}>
                    —
                  </p>
                ) : (
                  <div className="space-y-1">
                    {dayPosts.slice(0, 3).map((p) => (
                      <div key={p.id} className="flex items-center justify-between gap-2">
                        <span
                          className={cn(
                            "text-xs",
                            isPublishedDay ? "text-ig-on-primary" : "text-ig-muted",
                          )}
                        >
                          {format(parseISO(p.scheduled_at), "HH:mm")}
                        </span>
                        <StatusBadge status={p.status} onPrimary={isPublishedDay} />
                      </div>
                    ))}
                    {dayPosts.length > 3 && (
                      <p
                        className={cn(
                          "text-xs",
                          isPublishedDay ? "text-ig-on-primary/90" : "text-ig-muted",
                        )}
                      >
                        +{dayPosts.length - 3} mais
                      </p>
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
