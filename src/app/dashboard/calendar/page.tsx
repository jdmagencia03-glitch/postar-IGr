import { redirect } from "next/navigation";
import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  format,
  isBefore,
  isSameDay,
  parseISO,
  startOfDay,
  startOfMonth,
  subMonths,
} from "date-fns";
import { ptBR } from "date-fns/locale";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { AccountFilterBar } from "@/components/AccountFilterBar";
import { Navbar } from "@/components/Navbar";
import { StatusBadge } from "@/components/StatusBadge";
import { getSessionUserId } from "@/lib/meta/oauth";
import { getOwnerAccountRefs, getOwnerScheduledPosts } from "@/lib/posts";
import { createAdminClient } from "@/lib/supabase/admin";
import type { ScheduledPost, SocialPlatform } from "@/lib/types";
import { formatInAppTimezone } from "@/lib/timezone";
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

function buildMonthHref(
  basePath: string,
  month: Date,
  params: { account?: string; platform?: string },
) {
  const query = new URLSearchParams();
  query.set("month", format(month, "yyyy-MM"));
  if (params.platform && params.platform !== "all") query.set("platform", params.platform);
  if (params.account) query.set("account", params.account);
  return `${basePath}?${query.toString()}`;
}

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ account?: string; platform?: string; month?: string }>;
}) {
  const ownerId = await getSessionUserId();
  if (!ownerId) redirect("/login?next=/dashboard/calendar");

  const params = await searchParams;
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

  const now = new Date();
  const viewMonth = parseMonthParam(params.month);
  const prevMonth = subMonths(viewMonth, 1);
  const nextMonth = addMonths(viewMonth, 1);
  const filterParams = {
    account: selectedAccountId,
    platform: platformFilter === "all" ? undefined : platformFilter,
  };
  const days = eachDayOfInterval({
    start: startOfMonth(viewMonth),
    end: endOfMonth(viewMonth),
  });

  return (
    <div>
      <Navbar />
      <main className="mx-auto max-w-6xl px-4 py-8">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-ig-text">Calendário</h1>
            <p className="text-ig-muted">
              {format(viewMonth, "MMMM yyyy", { locale: ptBR })} · Instagram e TikTok
            </p>
          </div>
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
          extraParams={{ month: format(viewMonth, "yyyy-MM") }}
        />

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {days.map((day) => {
            const dayPosts = typedPosts.filter((p: ScheduledPost) =>
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
                            "inline-flex items-center gap-1 text-xs",
                            isPublishedDay ? "text-ig-on-primary" : "text-ig-muted",
                          )}
                        >
                          <span
                            className={cn(
                              "rounded px-1 text-[10px] font-semibold uppercase",
                              isPublishedDay
                                ? "bg-ig-on-primary/20 text-ig-on-primary"
                                : p.platform === "tiktok"
                                  ? "bg-black/10 text-ig-text"
                                  : "bg-ig-primary/10 text-ig-primary",
                            )}
                          >
                            {p.platform === "tiktok" ? "TT" : "IG"}
                          </span>
                          {formatInAppTimezone(p.scheduled_at, { hour: "2-digit", minute: "2-digit" })}
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
