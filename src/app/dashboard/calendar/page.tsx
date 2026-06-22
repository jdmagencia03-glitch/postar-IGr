import { redirect } from "next/navigation";
import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  format,
  isBefore,
  parseISO,
  startOfDay,
  startOfMonth,
  subMonths,
} from "date-fns";
import { ptBR } from "date-fns/locale";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { warmupDateKey } from "@/lib/account-warmup";
import { AccountFilterBar } from "@/components/AccountFilterBar";
import { CalendarDayPosts } from "@/components/calendar/CalendarDayPosts";
import { CalendarStatusFilter, type CalendarView } from "@/components/calendar/CalendarStatusFilter";
import { getSessionUserId } from "@/lib/meta/oauth";
import {
  getOwnerAccountRefs,
  getOwnerPostsForCalendarMonth,
  type CalendarMonthView,
} from "@/lib/posts";
import { createAdminClient } from "@/lib/supabase/admin";
import type { ScheduledPost, SocialPlatform } from "@/lib/types";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

function isPlatformFilter(value: string | undefined): value is SocialPlatform | "all" {
  return value === "instagram" || value === "tiktok" || value === "all" || value === undefined;
}

function parseMonthParam(value: string | undefined): Date {
  if (value && /^\d{4}-\d{2}$/.test(value)) {
    const parsed = parseISO(`${value}-01`);
    if (!Number.isNaN(parsed.getTime())) return startOfMonth(parsed);
  }
  return startOfMonth(new Date());
}

function parseCalendarView(value: string | undefined): CalendarView {
  if (value === "all" || value === "pending" || value === "published" || value === "cancelled") {
    return value;
  }
  return "active";
}

function buildMonthHref(
  basePath: string,
  month: Date,
  params: { account?: string; platform?: string; view?: CalendarView },
) {
  const query = new URLSearchParams();
  query.set("month", format(month, "yyyy-MM"));
  if (params.platform && params.platform !== "all") query.set("platform", params.platform);
  if (params.account) query.set("account", params.account);
  if (params.view && params.view !== "active") query.set("view", params.view);
  return `${basePath}?${query.toString()}`;
}

function indexPostsByLocalDate(posts: ScheduledPost[]) {
  const map = new Map<string, ScheduledPost[]>();
  for (const post of posts) {
    const key = warmupDateKey(new Date(post.scheduled_at));
    const list = map.get(key) ?? [];
    list.push(post);
    map.set(key, list);
  }
  return map;
}

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ account?: string; platform?: string; month?: string; view?: string }>;
}) {
  const ownerId = await getSessionUserId();
  if (!ownerId) redirect("/login?next=/dashboard/calendar");

  const params = await searchParams;
  const calendarView = parseCalendarView(params.view);
  const platformFilter: SocialPlatform | "all" = isPlatformFilter(params.platform)
    ? params.platform ?? "all"
    : "all";

  const supabase = createAdminClient();
  const accountRefs = await getOwnerAccountRefs(supabase, ownerId);
  const visibleRefs = accountRefs.filter(
    (account) => platformFilter === "all" || account.platform === platformFilter,
  );
  const selectedAccountId =
    params.account && visibleRefs.some((account) => account.id === params.account)
      ? params.account
      : undefined;

  const viewMonth = parseMonthParam(params.month);
  const monthKey = format(viewMonth, "yyyy-MM");

  const [{ posts: monthPosts, truncated }, { posts: activeMonthPosts }] = await Promise.all([
    getOwnerPostsForCalendarMonth(supabase, ownerId, {
      month: monthKey,
      platform: platformFilter,
      accountId: selectedAccountId,
      view: calendarView as CalendarMonthView,
    }),
    calendarView === "active"
      ? getOwnerPostsForCalendarMonth(supabase, ownerId, {
          month: monthKey,
          platform: platformFilter,
          accountId: selectedAccountId,
          view: "all",
        })
      : Promise.resolve({ posts: [] as ScheduledPost[], truncated: false }),
  ]);

  const visiblePosts = monthPosts;
  const postsByDay = indexPostsByLocalDate(visiblePosts);
  const allPostsByDay = calendarView === "active" ? indexPostsByLocalDate(activeMonthPosts) : postsByDay;

  const now = new Date();
  const prevMonth = subMonths(viewMonth, 1);
  const nextMonth = addMonths(viewMonth, 1);
  const filterParams = {
    account: selectedAccountId,
    platform: platformFilter === "all" ? undefined : platformFilter,
    view: calendarView,
  };
  const days = eachDayOfInterval({
    start: startOfMonth(viewMonth),
    end: endOfMonth(viewMonth),
  });

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <header className="ig-page-header mb-0">
          <h1>Calendário</h1>
          <p>{format(viewMonth, "MMMM yyyy", { locale: ptBR })} · Instagram e TikTok</p>
        </header>
        <div className="flex items-center gap-2">
          <a
            href={buildMonthHref("/dashboard/calendar", prevMonth, filterParams)}
            className="rounded-lg border border-ig-border bg-ig-elevated p-2 text-ig-text transition hover:bg-ig-secondary"
            title="Mês anterior"
          >
            <ChevronLeft size={18} />
          </a>
          <a
            href={buildMonthHref("/dashboard/calendar", nextMonth, filterParams)}
            className="rounded-lg border border-ig-border bg-ig-elevated p-2 text-ig-text transition hover:bg-ig-secondary"
            title="Próximo mês"
          >
            <ChevronRight size={18} />
          </a>
        </div>
      </div>

      {truncated && (
        <p className="mb-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-800">
          Muitos posts neste filtro — exibindo apenas parte do mês. Refine por conta ou use a fila em
          Operações.
        </p>
      )}

      <AccountFilterBar
        accounts={accountRefs}
        selectedAccountId={selectedAccountId}
        selectedPlatform={platformFilter}
        basePath="/dashboard/calendar"
        extraParams={{
          month: monthKey,
          ...(calendarView !== "active" ? { view: calendarView } : {}),
        }}
      />

      <CalendarStatusFilter
        currentView={calendarView}
        basePath="/dashboard/calendar"
        extraParams={{
          month: monthKey,
          platform: platformFilter === "all" ? undefined : platformFilter,
          account: selectedAccountId,
        }}
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {days.map((day) => {
          const dayKey = warmupDateKey(day);
          const dayPosts = postsByDay.get(dayKey) ?? [];
          const allDayPosts = allPostsByDay.get(dayKey) ?? [];
          const cancelledCount =
            calendarView === "active"
              ? allDayPosts.filter((post) => post.status === "cancelled").length
              : 0;
          const isPastDay = isBefore(startOfDay(day), startOfDay(now));
          const hasPublished = dayPosts.some((post) => post.status === "published");
          const isPublishedDay = isPastDay && hasPublished;

          return (
            <div
              key={dayKey}
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
              {dayPosts.length === 0 && cancelledCount === 0 ? (
                <p
                  className={cn(
                    "text-xs",
                    isPublishedDay ? "text-ig-on-primary/80" : "text-ig-muted",
                  )}
                >
                  —
                </p>
              ) : (
                <CalendarDayPosts
                  posts={dayPosts}
                  isPublishedDay={isPublishedDay}
                  initialVisible={calendarView === "cancelled" ? 3 : 6}
                  cancelledCount={cancelledCount}
                  cancelledHref={buildMonthHref("/dashboard/calendar", viewMonth, {
                    ...filterParams,
                    view: "cancelled",
                  })}
                />
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}
