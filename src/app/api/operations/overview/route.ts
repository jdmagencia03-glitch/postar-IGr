import { NextResponse } from "next/server";
import { getOwnerAccounts } from "@/lib/accounts";
import { getSessionUserId } from "@/lib/meta/oauth";
import { buildAllAccountOperationsSummaries } from "@/lib/operations/account-ops";
import { buildOperationsAlerts } from "@/lib/operations/alerts-engine";
import { computeOperationsSnapshot, getLastPublishedAt } from "@/lib/operations/compute";import { getOwnerAccountRefs, getOwnerScheduledPosts } from "@/lib/posts";
import { getOwnerTikTokAccounts } from "@/lib/tiktok/accounts";
import { getActiveBatchSummaryForOwner } from "@/lib/upload/batches";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function GET() {
  const ownerId = await getSessionUserId();
  if (!ownerId) {
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  }

  const supabase = createAdminClient();
  const [refs, igAccounts, tiktokAccounts, posts, activeBatch] = await Promise.all([
    getOwnerAccountRefs(supabase, ownerId),
    getOwnerAccounts(supabase, ownerId),
    getOwnerTikTokAccounts(supabase, ownerId),
    getOwnerScheduledPosts(supabase, ownerId, { hiddenFromReport: false, limit: 2000 }),
    getActiveBatchSummaryForOwner(supabase, ownerId),
  ]);

  const accounts = await buildAllAccountOperationsSummaries({
    refs,
    igAccounts,
    tiktokAccounts,
    posts,
    ownerId,
  });

  const snapshot = computeOperationsSnapshot(posts);
  const lastPublishAt = getLastPublishedAt(posts);

  const alerts = buildOperationsAlerts({
    accounts,
    posts,
    coverageDays: snapshot.coverageDays,
    cronConfigured: Boolean(process.env.CRON_SECRET?.trim()),
    lastPublishAt,
    activeUploadBatchId: activeBatch?.id ?? null,
  });

  return NextResponse.json({
    accounts,
    snapshot,
    alerts,
  });
}
