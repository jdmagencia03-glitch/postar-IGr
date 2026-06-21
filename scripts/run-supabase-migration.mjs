import fs from "node:fs";
import path from "node:path";

function loadEnv(filePath) {
  const env = {};
  if (!fs.existsSync(filePath)) return env;
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq);
    let value = trimmed.slice(eq + 1);
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }
  return env;
}

const env = {
  ...loadEnv(path.join(process.cwd(), ".env.local")),
  ...loadEnv(path.join(process.cwd(), ".env.vercel.tmp")),
  ...process.env,
};

const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const sqlFile = process.argv[2];
if (!sqlFile) {
  console.error("Usage: node scripts/run-supabase-migration.mjs <sql-file>");
  process.exit(1);
}

const sql = fs.readFileSync(path.resolve(sqlFile), "utf8");

async function checkTable() {
  const res = await fetch(`${supabaseUrl}/rest/v1/schedule_job_tasks?select=id&limit=1`, {
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
    },
  });
  return res;
}

async function runViaManagementApi(projectRef, accessToken) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query: sql }),
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`Management API ${res.status}: ${body}`);
  console.log("Migration applied via Supabase Management API");
}

async function runViaPostgres(connectionString) {
  const pg = await import("pg");
  const client = new pg.default.Client({ connectionString, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    await client.query(sql);
    console.log("Migration applied via direct Postgres connection");
  } finally {
    await client.end();
  }
}

const projectRef = new URL(supabaseUrl).hostname.split(".")[0];
console.log("Supabase project:", projectRef);

const tableCheck = await checkTable();
if (tableCheck.ok) {
  console.log("schedule_job_tasks already exists — nothing to do.");
  process.exit(0);
}

if (tableCheck.status !== 404 && !String(await tableCheck.clone().text()).includes("PGRST205")) {
  const text = await tableCheck.text();
  console.log("Table check:", tableCheck.status, text.slice(0, 200));
}

const accessToken = env.SUPABASE_ACCESS_TOKEN;
if (accessToken) {
  await runViaManagementApi(projectRef, accessToken);
  process.exit(0);
}

const connectionString =
  env.DATABASE_URL || env.SUPABASE_DB_URL || env.POSTGRES_URL || env.SUPABASE_DATABASE_URL;

if (connectionString) {
  await runViaPostgres(connectionString);
  process.exit(0);
}

console.error(`
Could not apply migration automatically.

The table schedule_job_tasks is missing. Apply manually in Supabase SQL Editor:
  supabase/schedule-jobs-queue.sql

Or set one of these env vars and re-run:
  SUPABASE_ACCESS_TOKEN  (Supabase dashboard → Account → Access Tokens)
  DATABASE_URL           (Project Settings → Database → Connection string)
`);
process.exit(1);
