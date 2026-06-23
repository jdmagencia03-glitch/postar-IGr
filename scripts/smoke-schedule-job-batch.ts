/**
 * Smoke test — pipeline de schedule jobs em lotes grandes.
 *
 * Uso:
 *   npx tsx scripts/smoke-schedule-job-batch.ts           # checks locais + schema (se .env.local)
 *   npx tsx scripts/smoke-schedule-job-batch.ts --live    # E2E controlado no Supabase (staging/dev)
 *   npx tsx scripts/smoke-schedule-job-batch.ts --sizes=5,20,50
 *
 * NÃO executar em produção até validação manual.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { resolve } from "path";
import {
  captionNeedsProcessing,
  countItemPipeline,
  deriveCaptionStatus,
} from "../src/lib/schedule-jobs/item-pipeline";
import { drainScheduleJobQueue } from "../src/lib/schedule-jobs/queue/drain";
import { isScheduleJobQueueReady } from "../src/lib/schedule-jobs/queue/schema";
import { isPipelineColumnReady } from "../src/lib/schedule-jobs/pipeline-schema";
import {
  buildJobStatusReadOnly,
  createScheduleJob,
  loadJobItemsForPipeline,
} from "../src/lib/schedule-jobs/repository";
import type { ScheduleJobItemRow } from "../src/lib/schedule-jobs/types";

const DEFAULT_SIZES = [5, 20, 50, 100, 200] as const;
const LIVE_DRAIN_ROUNDS = 40;
const LIVE_POLL_MS = 2_000;
const LIVE_TIMEOUT_MS = 180_000;

function loadEnv() {
  try {
    const raw = readFileSync(resolve(process.cwd(), ".env.local"), "utf8");
    for (const line of raw.split("\n")) {
      const m = line.match(/^([^#=]+)=(.*)$/);
      if (m) process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, "");
    }
  } catch {
    // ignore
  }
}

loadEnv();

const args = process.argv.slice(2);
const live = args.includes("--live");
const sizesArg = args.find((a) => a.startsWith("--sizes="));
const sizes = sizesArg
  ? sizesArg
      .replace("--sizes=", "")
      .split(",")
      .map((n) => Number.parseInt(n, 10))
      .filter((n) => Number.isFinite(n) && n > 0)
  : [...DEFAULT_SIZES];

let failed = 0;

function pass(name: string, detail = "") {
  console.log(`✓ ${name}${detail ? ` — ${detail}` : ""}`);
}

function fail(name: string, detail = "") {
  failed += 1;
  console.error(`✗ ${name}${detail ? ` — ${detail}` : ""}`);
}

function mockItem(index: number, overrides: Partial<ScheduleJobItemRow> = {}): ScheduleJobItemRow {
  return {
    id: `item-${index}`,
    schedule_job_id: "job-smoke",
    upload_file_id: `file-${index}`,
    sort_order: index,
    filename: `video-${index + 1}.mp4`,
    media_urls: [`https://example.com/v${index}.mp4`],
    status: overrides.status ?? "queued",
    scheduled_at: null,
    destinations: overrides.destinations ?? null,
    caption: overrides.caption ?? null,
    hashtags: overrides.hashtags ?? null,
    created_post_id: overrides.created_post_id ?? null,
    parent_publish_group_id: null,
    error_message: null,
    attempt_count: 0,
    pipeline: overrides.pipeline,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

function runUnitChecks() {
  const items = [
    mockItem(0),
    mockItem(1, { caption: "Legenda #viral", hashtags: "#viral" }),
    mockItem(2, {
      caption: "Pronto",
      destinations: [
        {
          platform: "instagram",
          account_id: "acc",
          caption: "Pronto",
          scheduled_at: new Date().toISOString(),
        },
      ],
    }),
    mockItem(3, {
      caption: "Falhou",
      status: "failed",
      pipeline: { caption_status: "caption_failed_persistent" },
    }),
  ];

  const counts = countItemPipeline(items);
  if (counts.total !== 4) fail("countItemPipeline total", String(counts.total));
  else pass("countItemPipeline total");
  if (counts.captionDone !== 2) fail("countItemPipeline captionDone", String(counts.captionDone));
  else pass("countItemPipeline captionDone");
  if (counts.captionFailed !== 1) fail("countItemPipeline captionFailed", String(counts.captionFailed));
  else pass("countItemPipeline captionFailed");
  if (counts.calendarDone !== 1) fail("countItemPipeline calendarDone", String(counts.calendarDone));
  else pass("countItemPipeline calendarDone");

  const done = mockItem(9, { caption: "ok" });
  if (captionNeedsProcessing(done)) fail("captionNeedsProcessing skip done");
  else pass("captionNeedsProcessing skip done");

  const retryable = mockItem(10, {
    pipeline: { caption_status: "caption_failed_retryable" },
  });
  if (!captionNeedsProcessing(retryable)) fail("captionNeedsProcessing retryable");
  else pass("captionNeedsProcessing retryable");

  if (deriveCaptionStatus(mockItem(11, { status: "processing" })) !== "caption_processing") {
    fail("deriveCaptionStatus processing");
  } else {
    pass("deriveCaptionStatus processing");
  }
}

async function checkSchema(supabase: SupabaseClient) {
  const [queueReady, pipelineReady] = await Promise.all([
    isScheduleJobQueueReady(supabase, true),
    isPipelineColumnReady(supabase, true),
  ]);

  if (queueReady) pass("Schema schedule_job_tasks");
  else fail("Schema schedule_job_tasks", "tabela ausente — necessária para fila");

  if (pipelineReady) pass("Schema schedule_job_items.pipeline");
  else fail("Schema schedule_job_items.pipeline", "coluna ausente — rodar schedule-job-items-pipeline.sql");

  return { queueReady, pipelineReady };
}

async function fetchJson(url: string, init?: RequestInit) {
  const response = await fetch(url, init);
  const text = await response.text();
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    fail(`HTTP ${response.status} sem JSON`, url);
    return { ok: false, status: response.status, body: null };
  }
  return { ok: response.ok, status: response.status, body };
}

async function validateNoBadHttp(baseUrl: string, jobId: string, cookie?: string) {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (cookie) headers.Cookie = cookie;

  const statusUrl = `${baseUrl}/api/schedule-jobs/${jobId}/status`;
  const result = await fetchJson(statusUrl, { headers, cache: "no-store" });

  if (result.status === 504) fail("status endpoint 504", statusUrl);
  else if (result.status >= 500) fail("status endpoint 5xx", `${result.status}`);
  else pass("status endpoint sem 504/5xx", `HTTP ${result.status}`);

  if (result.body === null) return null;
  return result.body as Record<string, unknown>;
}

function validateStatusShape(status: Record<string, unknown>, expectedTotal: number) {
  const total = Number(status.total ?? 0);
  const captionsDone = Number(status.captionsDone ?? 0);
  const calendarDone = Number(status.calendarDone ?? 0);

  if (total !== expectedTotal) fail("status.total", `${total} !== ${expectedTotal}`);
  else pass("status.total", String(total));

  if (captionsDone > total) fail("status.captionsDone overflow", `${captionsDone}/${total}`);
  else pass("status.captionsDone bounded");

  if (calendarDone > total) fail("status.calendarDone overflow", `${calendarDone}/${total}`);
  else pass("status.calendarDone bounded");

  if (status.statusError) fail("status.statusError", String(status.statusErrorMessage ?? ""));
  else pass("status sem statusError");
}

async function runLiveBatch(
  supabase: SupabaseClient,
  ownerId: string,
  accountId: string,
  size: number,
  baseUrl?: string,
) {
  const batchId = `smoke-batch-${size}-${Date.now()}`;
  const items = Array.from({ length: size }, (_, index) => ({
    uploadFileId: `${batchId}-file-${index}`,
    sortOrder: index,
    filename: `smoke-${index + 1}.mp4`,
    mediaUrls: [`https://example.com/${batchId}/${index}.mp4`],
  }));

  const { job } = await createScheduleJob(supabase, {
    ownerId,
    uploadBatchId: batchId,
    accountId,
    tiktokAccountId: null,
    platform: "instagram",
    config: {
      schedule_mode: "auto",
      schedule_strategy: "smart",
      targets: [{ platform: "instagram", account_id: accountId }],
    },
    items,
  });

  pass(`live job criado (${size})`, job.id);

  const started = Date.now();
  let lastStatus: Record<string, unknown> | null = null;

  while (Date.now() - started < LIVE_TIMEOUT_MS) {
    for (let round = 0; round < LIVE_DRAIN_ROUNDS; round++) {
      await drainScheduleJobQueue(supabase, { workerPrefix: `smoke-${size}`, maxMs: 5_000 });
    }

    const refreshed = await buildJobStatusReadOnly(supabase, job);
    lastStatus = refreshed as unknown as Record<string, unknown>;
    validateStatusShape(lastStatus, size);

    if (baseUrl) {
      const httpStatus = await validateNoBadHttp(baseUrl, job.id);
      if (httpStatus) validateStatusShape(httpStatus, size);
    }

    const dbItems = await loadJobItemsForPipeline(supabase, job.id);
    const duplicatePosts = dbItems.filter((item) => item.created_post_id).length;
    const captionsReady = dbItems.filter((item) => item.caption?.trim()).length;
    const withDestinations = dbItems.filter((item) => item.destinations?.length).length;

    const terminal =
      refreshed.status === "completed" ||
      refreshed.status === "partial_failed" ||
      refreshed.status === "failed";

    if (terminal) {
      pass(`live job terminal (${size})`, refreshed.status);
      if (duplicatePosts > size) fail("sem duplicar posts", `${duplicatePosts} posts`);
      else pass("sem duplicar posts");
      if (captionsReady < size && refreshed.status === "completed") {
        fail("legendas preservadas", `${captionsReady}/${size}`);
      } else {
        pass("legendas preservadas", `${captionsReady}/${size}`);
      }
      pass("calendário planejado", `${withDestinations}/${size} com destinations`);
      return;
    }

    await new Promise((r) => setTimeout(r, LIVE_POLL_MS));
  }

  fail(`live timeout (${size})`, JSON.stringify(lastStatus ?? {}));
  await supabase.from("schedule_jobs").update({ status: "cancelled" }).eq("id", job.id);
}

async function main() {
  console.log(`\n=== smoke-schedule-job-batch (${live ? "live" : "dry"}) ===\n`);
  console.log(`Tamanhos: ${sizes.join(", ")}\n`);

  runUnitChecks();

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.log("⚠ Credenciais Supabase ausentes — pulando checks de schema (ok em CI/dry)");
  } else {
    const supabase = createClient(url, key);
    const schema = await checkSchema(supabase);

    if (live) {
      if (!schema.queueReady || !schema.pipelineReady) {
        fail("live abortado", "schema incompleto — aplicar migrations no ambiente de teste primeiro");
      } else {
        const ownerId = process.env.SMOKE_OWNER_ID;
        const accountId = process.env.SMOKE_ACCOUNT_ID;
        if (!ownerId || !accountId) {
          fail("live config", "defina SMOKE_OWNER_ID e SMOKE_ACCOUNT_ID em .env.local");
        } else {
          const baseUrl = process.env.SMOKE_BASE_URL?.replace(/\/$/, "");
          for (const size of sizes) {
            console.log(`\n--- live batch: ${size} vídeos ---`);
            try {
              await runLiveBatch(supabase, ownerId, accountId, size, baseUrl);
            } catch (err) {
              fail(`live batch ${size}`, err instanceof Error ? err.message : String(err));
            }
          }
        }
      }
    } else {
      pass("modo dry-run", "use --live para E2E no Supabase de staging/dev");
    }
  }

  if (!live) {
    pass("modo dry-run", "checks locais concluídos");
  }

  console.log(`\nResultado: ${failed} falha(s)\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
