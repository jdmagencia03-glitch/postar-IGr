import fs from "node:fs";
import path from "node:path";

function loadEnv(filePath) {
  const env = {};
  if (!fs.existsSync(filePath)) return env;
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i < 0) continue;
    let v = t.slice(i + 1);
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    env[t.slice(0, i)] = v;
  }
  return env;
}

const env = {
  ...loadEnv(path.join(process.cwd(), ".env.local")),
  ...loadEnv(path.join(process.cwd(), ".env.vercel.prod")),
  ...loadEnv(path.join(process.cwd(), ".env.vercel.check")),
  ...loadEnv(path.join(process.cwd(), ".env.vercel.tmp")),
  ...process.env,
};

const url = env.NEXT_PUBLIC_SUPABASE_URL;
const key = env.SUPABASE_SERVICE_ROLE_KEY;
const cron = env.CRON_SECRET;

if (!url || !key) {
  console.error("missing supabase env");
  process.exit(1);
}

const headers = { apikey: key, Authorization: `Bearer ${key}` };
const jobPrefix = "00dcc032";

const jobs = await fetch(
  `${url}/rest/v1/schedule_jobs?id=like.${jobPrefix}*&select=id,status,current_step,total_items,processed_items,completed_items,failed_items,locked_by,lock_until,last_heartbeat_at,updated_at,upload_batch_id&order=updated_at.desc&limit=1`,
  { headers },
).then((r) => r.json());

console.log("=== JOB ===");
console.log(JSON.stringify(jobs, null, 2));

const job = jobs[0];
if (!job) process.exit(0);

const items = await fetch(
  `${url}/rest/v1/schedule_job_items?schedule_job_id=eq.${job.id}&select=status`,
  { headers },
).then((r) => r.json());

const itemCounts = {};
for (const row of items) {
  itemCounts[row.status] = (itemCounts[row.status] || 0) + 1;
}
console.log("\n=== ITEMS BY STATUS ===");
console.log(itemCounts);

const tr = await fetch(
  `${url}/rest/v1/schedule_job_tasks?schedule_job_id=eq.${job.id}&select=phase,status`,
  { headers },
);
if (tr.ok) {
  const tasks = await tr.json();
  const taskCounts = {};
  for (const row of tasks) {
    const k = `${row.phase}:${row.status}`;
    taskCounts[k] = (taskCounts[k] || 0) + 1;
  }
  console.log("\n=== TASKS ===");
  console.log(taskCounts, `(total ${tasks.length})`);
} else {
  console.log("\n=== TASKS ===");
  console.log("error", tr.status, await tr.text());
}

const pr = await fetch(
  `${url}/rest/v1/scheduled_posts?upload_batch_id=eq.${job.upload_batch_id}&select=id`,
  { headers: { ...headers, Prefer: "count=exact" } },
);
const postsBody = await pr.json();
console.log("\n=== SCHEDULED POSTS ===");
console.log({
  contentRange: pr.headers.get("content-range"),
  sampleLength: Array.isArray(postsBody) ? postsBody.length : postsBody,
});

if (cron) {
  const cr = await fetch("https://postarigr.vercel.app/api/cron/schedule-jobs", {
    headers: { Authorization: `Bearer ${cron}` },
  });
  console.log("\n=== CRON (production, current deploy) ===");
  console.log(cr.status, (await cr.text()).slice(0, 500));
}

const updatedAt = new Date(job.updated_at);
const hb = job.last_heartbeat_at ? new Date(job.last_heartbeat_at) : null;
const now = Date.now();
console.log("\n=== DIAGNÓSTICO ===");
console.log({
  tempo_desde_update_min: Math.round((now - updatedAt.getTime()) / 60000),
  tempo_desde_heartbeat_min: hb ? Math.round((now - hb.getTime()) / 60000) : null,
  lock_expirado: job.lock_until ? new Date(job.lock_until).getTime() <= now : true,
  posts_saved_counter: job.completed_items,
  posts_no_calendario: pr.headers.get("content-range"),
});
