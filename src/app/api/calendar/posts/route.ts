import { NextRequest, NextResponse } from "next/server";
import { dbTimeoutJsonResponse } from "@/lib/api/db-resilience";
import { getSessionUserId } from "@/lib/meta/oauth";
import { getOwnerPostsForCalendarMonth } from "@/lib/posts";
import { createAdminClient } from "@/lib/supabase/admin";
import { withTimeoutOrNull, DB_ROUTE_TIMEOUT_MS } from "@/lib/with-timeout";

export const dynamic = "force-dynamic";

/** Posts do calendário por mês — resposta leve com fallback em timeout. */
export async function GET(request: NextRequest) {
  const ownerId = await getSessionUserId();
  if (!ownerId) {
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  }

  const month = request.nextUrl.searchParams.get("month") ?? "";
  if (!/^\d{4}-\d{2}$/.test(month)) {
    return NextResponse.json({ ok: false, error: "invalid_month", data: [] }, { status: 400 });
  }

  const supabase = createAdminClient();
  const result = await withTimeoutOrNull(
    getOwnerPostsForCalendarMonth(supabase, ownerId, { month, view: "active" }),
    DB_ROUTE_TIMEOUT_MS,
    "api-calendar-posts",
  );

  if (result === null) {
    return dbTimeoutJsonResponse([]);
  }

  return NextResponse.json({ ok: true, data: result.posts, truncated: result.truncated });
}
