import { readFileSync } from "fs";
import { createClient } from "@supabase/supabase-js";

for (const line of readFileSync(".env.vercel.prod", "utf8").split(/\n/)) {
  const m = line.match(/^([^#=]+)=(.*)$/);
  if (m) {
    let v = m[2].trim();
    if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
    process.env[m[1].trim()] = v;
  }
}

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

const { data: jobs, error } = await sb
  .from("schedule_jobs")
  .select(
    "id,status,current_step,total_items,processed_items,completed_items,failed_items,locked_by,lock_until,last_heartbeat_at,updated_at,upload_batch_id",
  )
  .in("status", ["queued", "processing", "partial_failed"])
  .order("updated_at", { ascending: false })
  .limit(5);

if (error) {
  console.error("JOBS_ERROR", error.message);
  process.exit(1);
}

console.log(JSON.stringify({ activeJobs: jobs }, null, 2));

const job = jobs?.[0];
if (!job) {
  console.log(JSON.stringify({ message: "NO_ACTIVE_JOB" }));
  process.exit(0);
}

const { count } = await sb
  .from("scheduled_posts")
  .select("id", { count: "exact", head: true })
  .eq("upload_batch_id", job.upload_batch_id);

const { data: items } = await sb
  .from("schedule_job_items")
  .select("status,created_post_id")
  .eq("schedule_job_id", job.id);

const itemStats = {};
let withPost = 0;
for (const i of items ?? []) {
  itemStats[i.status] = (itemStats[i.status] || 0) + 1;
  if (i.created_post_id) withPost += 1;
}

const now = Date.now();
console.log(
  JSON.stringify(
    {
      jobId: job.id,
      minutesSinceUpdated: Math.round((now - new Date(job.updated_at).getTime()) / 60000),
      minutesSinceHeartbeat: job.last_heartbeat_at
        ? Math.round((now - new Date(job.last_heartbeat_at).getTime()) / 60000)
        : null,
      scheduledPostsForBatch: count,
      itemsWithCreatedPostId: withPost,
      itemStats,
    },
    null,
    2,
  ),
);

const secret = process.env.CRON_SECRET;
const res = await fetch("https://postarigr.vercel.app/api/cron/schedule-jobs", {
  headers: { Authorization: `Bearer ${secret}` },
});
const body = await res.text();
console.log(
  JSON.stringify({ cronTest: { status: res.status, body: body.slice(0, 800) } }, null, 2),
);
