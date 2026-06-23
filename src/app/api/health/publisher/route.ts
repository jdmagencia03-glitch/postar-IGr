import { NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/meta/oauth";
import { getOwnerPublisherHealthMetrics } from "@/lib/posts/dashboard-data";
import { createAdminClient } from "@/lib/supabase/admin";
import { withHardTimeout, DB_ROUTE_TIMEOUT_MS } from "@/lib/with-timeout";

export async function GET() {
  const ownerId = await getSessionUserId();
  if (!ownerId) {
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  }

  const cronConfigured = Boolean(process.env.CRON_SECRET?.trim());
  const supabase = createAdminClient();
  const now = new Date();

  const metrics = await withHardTimeout(
    getOwnerPublisherHealthMetrics(supabase, ownerId),
    DB_ROUTE_TIMEOUT_MS,
    null,
    "api-health-publisher",
  );

  if (!metrics) {
    return NextResponse.json(
      {
        cron_configured: cronConfigured,
        overdue_pending: 0,
        stuck_processing: 0,
        retrying: 0,
        failed_persistent: 0,
        pending: 0,
        last_publish_at: null,
        cron_stale: false,
        status: "attention",
        healthy: false,
        degraded: true,
      },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  const {
    overdue_pending: overduePending,
    stuck_processing: stuckProcessing,
    retrying,
    failed_persistent: failedPersistent,
    pending,
    last_publish_at: lastPublishAt,
  } = metrics;

  let cronStale = false;
  if (lastPublishAt) {
    cronStale = now.getTime() - new Date(lastPublishAt).getTime() > 30 * 60_000 && overduePending > 0;
  } else if (overduePending > 0) {
    cronStale = true;
  }

  let status: "healthy" | "attention" | "critical" = "healthy";
  if (!cronConfigured || stuckProcessing > 0 || failedPersistent >= 3) {
    status = "critical";
  } else if (overduePending > 0 || retrying > 0 || cronStale || failedPersistent > 0) {
    status = "attention";
  }

  const healthy = status === "healthy";

  return NextResponse.json({
    cron_configured: cronConfigured,
    overdue_pending: overduePending,
    stuck_processing: stuckProcessing,
    retrying,
    failed_persistent: failedPersistent,
    pending,
    last_publish_at: lastPublishAt,
    cron_stale: cronStale,
    status,
    healthy,
  });
}
