import { existsSync, readFileSync } from "fs";

function loadEnv(filePath) {
  if (!existsSync(filePath)) return;
  for (const line of readFileSync(filePath, "utf8").split(/\n/)) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (m) {
      let v = m[2].trim();
      if (
        (v.startsWith('"') && v.endsWith('"')) ||
        (v.startsWith("'") && v.endsWith("'"))
      ) {
        v = v.slice(1, -1);
      }
      if (v && !process.env[m[1].trim()]) process.env[m[1].trim()] = v;
    }
  }
}

loadEnv(".env.local");
loadEnv(".env.vercel.check");
loadEnv(".env.vercel.prod");
loadEnv(".env.vercel.runtime");

const { createClient } = await import("@supabase/supabase-js");
const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

const jobId = process.argv[2] ?? "00dcc032-d212-4a9f-a6b7-445659db1be2";
const now = new Date();

const fmt = (iso) =>
  new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(iso));

const { data: job } = await sb
  .from("schedule_jobs")
  .select(
    "id,status,current_step,total_items,processed_items,completed_items,failed_items,upload_batch_id,updated_at",
  )
  .eq("id", jobId)
  .maybeSingle();

const batchId = job?.upload_batch_id;

const { data: posts } = await sb
  .from("scheduled_posts")
  .select(
    "id,status,scheduled_at,created_at,platform,caption,media_id,publish_error,account_id,tiktok_account_id",
  )
  .eq("upload_batch_id", batchId)
  .order("scheduled_at", { ascending: true });

const byStatus = {};
for (const p of posts ?? []) byStatus[p.status] = (byStatus[p.status] ?? 0) + 1;

const active = (posts ?? []).filter((p) =>
  ["pending", "retrying", "processing"].includes(p.status),
);
const pastDue = active.filter((p) => new Date(p.scheduled_at) <= now);

const mapPost = (p) => ({
  id: p.id.slice(0, 8),
  status: p.status,
  br: fmt(p.scheduled_at),
  utc: p.scheduled_at,
  platform: p.platform ?? "instagram",
  hasMedia: Boolean(p.media_id),
  error: p.publish_error?.slice(0, 80) ?? null,
});

console.log(
  JSON.stringify(
    {
      nowUtc: now.toISOString(),
      nowBr: fmt(now),
      job,
      totalPosts: posts?.length ?? 0,
      byStatus,
      activeCount: active.length,
      pastDueStillPending: pastDue.length,
      pastDueSample: pastDue.slice(0, 8).map(mapPost),
      firstPosts: (posts ?? []).slice(0, 5).map(mapPost),
      lastPosts: (posts ?? []).slice(-5).map(mapPost),
    },
    null,
    2,
  ),
);

const ids = (posts ?? []).map((p) => p.id);
if (ids.length) {
  const { data: logs } = await sb
    .from("publish_logs")
    .select("post_id,level,message,created_at")
    .in("post_id", ids.slice(0, 80))
    .order("created_at", { ascending: false })
    .limit(20);

  console.log("\nRECENT_PUBLISH_LOGS");
  console.log(
    JSON.stringify(
      (logs ?? []).map((l) => ({
        post: l.post_id.slice(0, 8),
        level: l.level,
        msg: l.message?.slice(0, 140),
        at: fmt(l.created_at),
      })),
      null,
      2,
    ),
  );
}

// Check if any active posts still look 3h early (scheduled hour always at :00/:30 typical slots)
const hours = active.map((p) => {
  const d = new Date(p.scheduled_at);
  const br = new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
  return br;
});
const hourCounts = {};
for (const h of hours) hourCounts[h] = (hourCounts[h] ?? 0) + 1;
console.log("\nACTIVE_HOURS_BR", hourCounts);

const { data: recentJobs } = await sb
  .from("schedule_jobs")
  .select(
    "id,status,current_step,total_items,completed_items,failed_items,upload_batch_id,updated_at",
  )
  .order("updated_at", { ascending: false })
  .limit(5);

console.log("\nRECENT_JOBS");
console.log(JSON.stringify(recentJobs, null, 2));

const { data: allActive } = await sb
  .from("scheduled_posts")
  .select("id,status,scheduled_at,platform,upload_batch_id")
  .in("status", ["pending", "retrying", "processing"])
  .order("scheduled_at", { ascending: true })
  .limit(200);

const allPastDue = (allActive ?? []).filter((p) => new Date(p.scheduled_at) <= now);
console.log("\nALL_ACCOUNTS_ACTIVE", {
  total: allActive?.length ?? 0,
  pastDue: allPastDue.length,
  next5: (allActive ?? []).slice(0, 5).map(mapPost),
});

