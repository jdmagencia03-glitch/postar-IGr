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
import { AccountFilterBar } from "@/components/AccountFilterBar";
import { CalendarDayPosts } from "@/components/calendar/CalendarDayPosts";
import { CalendarStatusFilter, type CalendarView } from "@/components/calendar/CalendarStatusFilter";
import { getSessionUserId } from "@/lib/meta/oauth";
import { getOwnerAccountRefs, getOwnerScheduledPosts } from "@/lib/posts";
import { createAdminClient } from "@/lib/supabase/admin";
import type { ScheduledPost, SocialPlatform } from "@/lib/types";
import { isSameAppDay } from "@/lib/timezone";
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

function filterCalendarPosts(posts: ScheduledPost[], view: CalendarView) {
  switch (view) {
    case "all":
      return posts;
    case "cancelled":
      return posts.filter((post) => post.status === "cancelled");
    case "published":
      return posts.filter((post) => post.status === "published");
    case "pending":
      return posts.filter((post) =>
        ["pending", "processing", "retrying", "failed", "failed_persistent", "needs_media"].includes(
          post.status,
        ),
      );
    case "active":
    default:
      return posts.filter((post) => post.status !== "cancelled");
  }
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

  const typedPosts = await getOwnerScheduledPosts(supabase, ownerId, {
    platform: platformFilter,
    accountId: selectedAccountId,
    order: "asc",
  });

  const visiblePosts = filterCalendarPosts(typedPosts, calendarView);

  const now = new Date();
  const viewMonth = parseMonthParam(params.month);
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

        <AccountFilterBar
          accounts={accountRefs}
          selectedAccountId={selectedAccountId}
          selectedPlatform={platformFilter}
          basePath="/dashboard/calendar"
          extraParams={{
            month: format(viewMonth, "yyyy-MM"),
            ...(calendarView !== "active" ? { view: calendarView } : {}),
          }}
        />

        <CalendarStatusFilter
          currentView={calendarView}
          basePath="/dashboard/calendar"
          extraParams={{
            month: format(viewMonth, "yyyy-MM"),
            platform: platformFilter === "all" ? undefined : platformFilter,
            account: selectedAccountId,
          }}
        />

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {days.map((day) => {
            const allDayPosts = typedPosts.filter((p: ScheduledPost) =>
              isSameAppDay(p.scheduled_at, day),
            );
            const dayPosts = visiblePosts.filter((p: ScheduledPost) =>
              isSameAppDay(p.scheduled_at, day),
            );
            const cancelledCount =
              calendarView === "active"
                ? allDayPosts.filter((post) => post.status === "cancelled").length
                : 0;
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
                {dayPosts.length === 0 && cancelledCount === 0 ? (
                  <p className={cn("text-xs", isPublishedDay ? "text-ig-on-primary/80" : "text-ig-muted")}>
                    —
                  </p>
                ) : (
                  <CalendarDayPosts
                    posts={dayPosts}
                    isPublishedDay={isPublishedDay}
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
