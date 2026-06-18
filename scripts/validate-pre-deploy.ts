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
    confirmSrc.includes("contentTypeForPlatform")
  ) {
    pass("Confirm: 2 registros/vídeo com group id e horários futuros");
  } else fail("Confirm multiplataforma");
}

async function main() {
  console.log("\n=== Validação pré-deploy ===\n");

  await checkSupabaseColumns();
  runLogicTests();
  checkCronIndependence();
  checkReportsFilters();
  checkFlows();

  console.log(`\n=== ${failed === 0 ? "TODOS OS TESTES PASSARAM" : `${failed} FALHA(S)`} ===\n`);
  process.exit(failed > 0 ? 1 : 0);
}

void main();
