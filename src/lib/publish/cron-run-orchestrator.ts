import type { AdminClient } from "@/lib/publish/cron-run-shared";
import { toOrchestratorPlatformSummary } from "@/lib/publish/cron-run-shared";
import { runInstagramPublishCron } from "@/lib/publish/cron-run-instagram";
import { runTikTokPublishCron } from "@/lib/publish/cron-run-tiktok";

export type PublishCronOrchestratorResult = {
  ok: boolean;
  mode: "orchestrator";
  results: {
    instagram: ReturnType<typeof toOrchestratorPlatformSummary> & {
      media_cleanup?: unknown;
    };
    tiktok: ReturnType<typeof toOrchestratorPlatformSummary>;
  };
};

export async function runPublishCronOrchestrator(
  supabase: AdminClient,
): Promise<PublishCronOrchestratorResult> {
  const [instagramSettled, tiktokSettled] = await Promise.allSettled([
    runInstagramPublishCron(supabase),
    runTikTokPublishCron(supabase),
  ]);

  const instagram =
    instagramSettled.status === "fulfilled"
      ? instagramSettled.value
      : {
          platform: "instagram" as const,
          ok: false,
          recovered_stale_processing: 0,
          processed: 0,
          published: 0,
          failed: 0,
          skipped: 0,
          results: [],
          fatalError:
            instagramSettled.reason instanceof Error
              ? instagramSettled.reason.message
              : "Falha no cron Instagram",
        };

  const tiktok =
    tiktokSettled.status === "fulfilled"
      ? tiktokSettled.value
      : {
          platform: "tiktok" as const,
          ok: false,
          recovered_stale_processing: 0,
          processed: 0,
          published: 0,
          failed: 0,
          skipped: 0,
          results: [],
          fatalError:
            tiktokSettled.reason instanceof Error
              ? tiktokSettled.reason.message
              : "Falha no cron TikTok",
        };

  const instagramSummary = {
    ...toOrchestratorPlatformSummary(instagram),
    ...(instagramSettled.status === "fulfilled"
      ? { media_cleanup: instagramSettled.value.media_cleanup }
      : {}),
  };

  return {
    ok: instagramSummary.ok,
    mode: "orchestrator",
    results: {
      instagram: instagramSummary,
      tiktok: toOrchestratorPlatformSummary(tiktok),
    },
  };
}

/** @deprecated Use runPublishCronOrchestrator ou os crons por plataforma. */
export async function runPublishCron(supabase: AdminClient) {
  const orchestrated = await runPublishCronOrchestrator(supabase);
  return {
    recovered_stale_processing:
      orchestrated.results.instagram.recovered_stale_processing +
      orchestrated.results.tiktok.recovered_stale_processing,
    processed: orchestrated.results.instagram.processed + orchestrated.results.tiktok.processed,
    results: [
      ...(orchestrated.results.instagram.processed > 0
        ? [{ id: "instagram-batch", status: orchestrated.results.instagram.ok ? "published" : "failed" }]
        : []),
      ...(orchestrated.results.tiktok.processed > 0
        ? [{ id: "tiktok-batch", status: orchestrated.results.tiktok.ok ? "published" : "failed" }]
        : []),
    ],
    media_cleanup:
      "media_cleanup" in orchestrated.results.instagram
        ? orchestrated.results.instagram.media_cleanup
        : null,
    orchestrator: orchestrated,
  };
}
