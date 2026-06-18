/**
 * Validação pré-deploy — Sprint 2A + horários futuros
 * Executar: npx tsx scripts/validate-pre-deploy.ts
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { resolve } from "path";
import { generateCustomSchedule, earliestScheduleInstant, sanitizeScheduledAt, ensureFutureScheduleSlot } from "../src/lib/smart-schedule";
import { zonedDateTimeToUtc, formatInAppTimezone } from "../src/lib/timezone";
import { contentTypeForPlatform } from "../src/lib/content-types";
import { TIKTOK_SCHEDULE_OFFSET_MINUTES } from "../src/lib/multiplatform/types";
import { generateBulkCaptions } from "../src/lib/ai/captions";
import { groupScheduledPostsByPublishGroup } from "../src/lib/operations/group-posts";
import type { ScheduledPost } from "../src/lib/types";

function loadEnv() {
  try {
    const raw = readFileSync(resolve(process.cwd(), ".env.local"), "utf8");
    for (const line of raw.split("\n")) {
      const m = line.match(/^([^#=]+)=(.*)$/);
      if (m) process.env[m[1].trim()] = m[2].trim();
    }
  } catch {
    // ignore
  }
}

loadEnv();

let failed = 0;

function pass(name: string, detail = "") {
  console.log(`✓ ${name}${detail ? ` — ${detail}` : ""}`);
}

function fail(name: string, detail = "") {
  failed++;
  console.error(`✗ ${name}${detail ? ` — ${detail}` : ""}`);
}

async function checkSupabaseColumns() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    fail("Migration Supabase", "Credenciais ausentes em .env.local");
    return;
  }

  const supabase = createClient(url, key);
  const { error } = await supabase
    .from("scheduled_posts")
    .select("content_type, parent_publish_group_id")
    .limit(1);

  if (error) {
    fail("Migration Supabase", error.message);
    return;
  }

  pass("Migration Supabase", "content_type e parent_publish_group_id acessíveis");
}

function runLogicTests() {
  const now = zonedDateTimeToUtc(2026, 6, 18, 10, 30);
  const { schedule } = generateCustomSchedule(
    3,
    {
      postsPerDay: 3,
      timeSlots: [
        { hour: 7, minute: 0 },
        { hour: 9, minute: 0 },
        { hour: 11, minute: 0 },
      ],
    },
    now,
  );

  const earliest = earliestScheduleInstant(now);
  const labels = schedule.map((d) => formatInAppTimezone(d));

  if (schedule.every((d) => d > earliest)) {
    pass("Horários no passado (custom)", labels.join(" | "));
  } else {
    fail("Horários no passado (custom)", labels.join(" | "));
  }

  const ttSchedules = schedule.map((s) =>
    ensureFutureScheduleSlot(new Date(s.getTime() + TIKTOK_SCHEDULE_OFFSET_MINUTES * 60_000), now),
  );
  const offsetMs = ttSchedules[2].getTime() - schedule[2].getTime();
  if (offsetMs === TIKTOK_SCHEDULE_OFFSET_MINUTES * 60_000) {
    pass("TikTok offset +15min", formatInAppTimezone(ttSchedules[2]));
  } else {
    fail("TikTok offset +15min", `delta=${offsetMs}ms`);
  }

  if (contentTypeForPlatform("instagram") === "reel") pass("content_type Instagram", "reel");
  else fail("content_type Instagram");

  if (contentTypeForPlatform("tiktok") === "tiktok_video") pass("content_type TikTok", "tiktok_video");
  else fail("content_type TikTok");

  const pastIso = new Date(now.getTime() - 3600_000).toISOString();
  const sanitized = sanitizeScheduledAt(pastIso, now);
  if (new Date(sanitized) > earliest) pass("sanitizeScheduledAt", formatInAppTimezone(sanitized));
  else fail("sanitizeScheduledAt");
}

function checkCronIndependence() {
  const cronSrc = readFileSync(resolve(process.cwd(), "src/app/api/cron/publish/route.ts"), "utf8");
  if (cronSrc.includes('platform === "tiktok"') && cronSrc.includes("publishPost(")) {
    pass("Cron plataformas independentes");
  } else {
    fail("Cron plataformas independentes");
  }
}

function checkReportsFilters() {
  const reportsSrc = readFileSync(resolve(process.cwd(), "src/app/dashboard/reports/page.tsx"), "utf8");
  const opsSrc = readFileSync(resolve(process.cwd(), "src/components/operations/OperationsCenter.tsx"), "utf8");
  const postsSrc = readFileSync(resolve(process.cwd(), "src/lib/posts.ts"), "utf8");

  if (reportsSrc.includes("platformFilter") && reportsSrc.includes("contentTypeFilter")) {
    pass("Relatórios filtros platform + content_type");
  } else fail("Relatórios filtros");

  if (opsSrc.includes('["instagram", "Instagram"]') && opsSrc.includes('["tiktok", "TikTok"]')) {
    pass("Operações tabs Instagram/TikTok");
  } else fail("Operações tabs plataforma");

  if (opsSrc.includes('["tiktok_video", "TikTok Videos"]')) {
    pass("Operações tab TikTok Videos");
  } else fail("Operações tab TikTok Videos");

  if (postsSrc.includes("contentType") && postsSrc.includes("platform")) {
    pass("posts.ts filtra por platform e contentType");
  } else fail("posts.ts filtros");
}

function checkFlows() {
  const bulkSrc = readFileSync(resolve(process.cwd(), "src/components/BulkUploadForm.tsx"), "utf8");
  const autopilotSrc = readFileSync(resolve(process.cwd(), "src/app/api/posts/autopilot/route.ts"), "utf8");
  const confirmSrc = readFileSync(
    resolve(process.cwd(), "src/app/api/posts/multiplatform/confirm/route.ts"),
    "utf8",
  );

  if (bulkSrc.includes('destinationMode === "both"') && bulkSrc.includes("runAutopilot")) {
    pass("Fluxo antigo (IG ou TT só)", "runAutopilot preservado");
  } else fail("Fluxo antigo");

  if (bulkSrc.includes("runMultiplatformPreview") && bulkSrc.includes("MultiplatformPreview")) {
    pass("Fluxo novo IG+TT", "preview + confirm separados");
  } else fail("Fluxo novo IG+TT");

  if (autopilotSrc.includes("contentTypeForPlatform(platform)")) {
    pass("Autopilot content_type por plataforma");
  } else fail("Autopilot content_type");

  if (
    confirmSrc.includes("parent_publish_group_id") &&
    confirmSrc.includes("flatMap") &&
    confirmSrc.includes("sanitizeScheduledAt") &&
    confirmSrc.includes("contentTypeForPlatform") &&
    confirmSrc.includes("getOwnerAccountById") &&
    confirmSrc.includes("getOwnerTikTokAccountById")
  ) {
    pass("Confirm: ownership + 2 registros/vídeo com group id e horários futuros");
  } else fail("Confirm multiplataforma");
}

async function checkCaptionPlatformsInLargeBatches() {
  const counts = [5, 25, 30, 50];

  for (const count of counts) {
    const filenames = Array.from({ length: count }, (_, index) => `video-${index + 1}.mp4`);
    const instagram = await generateBulkCaptions({
      count,
      filenames,
      niche: "fitness",
      platform: "instagram",
    });
    const tiktok = await generateBulkCaptions({
      count,
      filenames,
      niche: "fitness",
      platform: "tiktok",
    });

    if (instagram.captions.length !== count || tiktok.captions.length !== count) {
      fail(`Legendas lote ${count}`, "quantidade incorreta");
      continue;
    }

    const tiktokStyled = tiktok.captions.every(
      (caption) => caption.includes("#fyp") || caption.includes("#foryou"),
    );
    const instagramStyled = instagram.captions.every((caption) => caption.includes("#reels"));
    const differs = tiktok.captions.some((caption, index) => caption !== instagram.captions[index]);

    if (tiktokStyled && instagramStyled && differs) {
      pass(`Legendas lote ${count}`, "plataforma preservada em chunks");
    } else {
      fail(`Legendas lote ${count}`, `tt=${tiktokStyled} ig=${instagramStyled} diff=${differs}`);
    }
  }
}

function checkPublishGroupUi() {
  const postsManagerSrc = readFileSync(resolve(process.cwd(), "src/components/PostsManager.tsx"), "utf8");
  const groupSrc = readFileSync(resolve(process.cwd(), "src/lib/operations/group-posts.ts"), "utf8");

  if (
    postsManagerSrc.includes("groupScheduledPostsByPublishGroup") &&
    postsManagerSrc.includes("MultiplatformPostGroup")
  ) {
    pass("UI agrupamento multiplataforma");
  } else fail("UI agrupamento multiplataforma");

  const sample = [
    { id: "a", parent_publish_group_id: "g1" },
    { id: "b", parent_publish_group_id: "g1" },
    { id: "c", parent_publish_group_id: null },
  ] as ScheduledPost[];

  const grouped = groupScheduledPostsByPublishGroup(sample);
  const hasGroup = grouped.some((item) => item.kind === "group" && item.posts.length === 2);
  const hasSingle = grouped.some((item) => item.kind === "single" && item.post.id === "c");

  if (hasGroup && hasSingle) pass("groupScheduledPostsByPublishGroup");
  else fail("groupScheduledPostsByPublishGroup");
}

async function main() {
  console.log("\n=== Validação pré-deploy ===\n");

  await checkSupabaseColumns();
  runLogicTests();
  checkCronIndependence();
  checkReportsFilters();
  checkFlows();
  checkPublishGroupUi();
  await checkCaptionPlatformsInLargeBatches();

  console.log(`\n=== ${failed === 0 ? "TODOS OS TESTES PASSARAM" : `${failed} FALHA(S)`} ===\n`);
  process.exit(failed > 0 ? 1 : 0);
}

void main();
