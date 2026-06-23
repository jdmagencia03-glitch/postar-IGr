import { NextRequest, NextResponse } from "next/server";
import {
  apiSessionErrorResponse,
  requireApiSessionSafe,
} from "@/lib/auth/api-session";
import { dbTimeoutJsonResponse } from "@/lib/api/db-resilience";
import { getOwnerPostsForCalendarMonth, type CalendarMonthView } from "@/lib/posts";
import { createAdminClient } from "@/lib/supabase/admin";
import { withHardTimeout, DB_ROUTE_TIMEOUT_MS } from "@/lib/with-timeout";

export const dynamic = "force-dynamic";

const ROUTE = "/api/calendar/posts";

/** Posts do calendário por mês — resposta leve com fallback em timeout. */
export async function GET(request: NextRequest) {
  try {
    const session = await requireApiSessionSafe(ROUTE);
    if (!session.ok) {
      return apiSessionErrorResponse(session, []);
    }

    const month = request.nextUrl.searchParams.get("month") ?? "";
    const viewParam = request.nextUrl.searchParams.get("view");
    const view = (viewParam ?? "active") as CalendarMonthView;

    if (!/^\d{4}-\d{2}$/.test(month)) {
      return NextResponse.json({ ok: false, error: "invalid_month", data: [] }, { status: 400 });
    }

    const supabase = createAdminClient();
    const result = await withHardTimeout(
      getOwnerPostsForCalendarMonth(supabase, session.userId, { month, view }),
      DB_ROUTE_TIMEOUT_MS,
      null,
      "api-calendar-posts",
    );

    if (result === null) {
      return dbTimeoutJsonResponse([]);
    }

    return NextResponse.json({ ok: true, data: result.posts, truncated: result.truncated });
  } catch (error) {
    console.error("[api-handler-failed]", { route: ROUTE, error });
    return NextResponse.json(
      {
        ok: false,
        error: "server_error",
        message: "Erro temporário no servidor.",
        data: [],
      },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
