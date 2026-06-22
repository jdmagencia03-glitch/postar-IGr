import { readFileSync } from "node:fs";
import { join } from "node:path";

const jobId = process.argv[2] ?? "f4ac3a3b-885b-44b5-ba18-c65a78f9723b";
const mode = process.argv[3] ?? "all";
const projectId = "prj_Oay0JliI4gYBEod3krJYERtQQ1PE";
const teamId = "team_ZtKXuMoLlaOkfhews01gPijl";

function loadVercelToken() {
  const paths = [
    join(process.env.APPDATA ?? "", "com.vercel.cli", "Data", "auth.json"),
    join(process.env.APPDATA ?? "", "xdg.data", "com.vercel.cli", "auth.json"),
  ];
  for (const file of paths) {
    try {
      const auth = JSON.parse(readFileSync(file, "utf8"));
      const token = auth.token;
      if (token) return token;
    } catch {
      // try next
    }
  }
  throw new Error("vercel_auth_missing");
}

async function loadProductionEnv() {
  const token = loadVercelToken();
  const url = `https://api.vercel.com/v10/projects/${projectId}/env?decrypt=true&teamId=${teamId}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error(`vercel_env_fetch_failed:${res.status}`);
  }
  const body = await res.json();
  const envs = body.envs ?? [];
  for (const entry of envs) {
    if (entry.target?.includes("production") && entry.value) {
      process.env[entry.key] = entry.value;
    }
  }
}

await loadProductionEnv();

if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("supabase_env_missing_after_vercel_fetch");
}

const base = process.env.NEXT_PUBLIC_APP_URL ?? "https://postarigr.vercel.app";
const cron = process.env.CRON_SECRET;
if (!cron) throw new Error("cron_secret_missing");

async function api(method, path, body) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${cron}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text.slice(0, 500) };
  }
  return { status: res.status, json };
}

if (mode === "status" || mode === "before" || mode === "all") {
  const before = await api("GET", `/api/schedule-jobs/${jobId}/status`);
  console.log("=== STATUS BEFORE ===");
  console.log(
    JSON.stringify(
      {
        http: before.status,
        status: before.json.status,
        postsSaved: before.json.postsSaved,
        postsInCalendar: before.json.postsInCalendar,
        failed: before.json.failed,
        plannedSample: before.json.plannedPosts?.slice(0, 7),
      },
      null,
      2,
    ),
  );
}

if (mode === "recalculate" || mode === "all") {
  const recalc = await api("POST", `/api/schedule-jobs/${jobId}/recalculate-warmup-times`);
  console.log("\n=== RECALCULATE ===");
  console.log(
    JSON.stringify(
      {
        http: recalc.status,
        ok: recalc.json.ok,
        updated: recalc.json.updated,
        warmupStartDate: recalc.json.warmupStartDate,
        planningMeta: recalc.json.planningMeta,
        afterSample: recalc.json.after?.slice(0, 7),
      },
      null,
      2,
    ),
  );
}

if (mode === "status" || mode === "after" || mode === "all") {
  const after = await api("GET", `/api/schedule-jobs/${jobId}/status`);
  console.log("\n=== STATUS AFTER ===");
  console.log(
    JSON.stringify(
      {
        http: after.status,
        status: after.json.status,
        postsSaved: after.json.postsSaved,
        postsInCalendar: after.json.postsInCalendar,
        failed: after.json.failed,
        plannedSample: after.json.plannedPosts?.slice(0, 7),
      },
      null,
      2,
    ),
  );
}
