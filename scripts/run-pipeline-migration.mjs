/**
 * Aplica schedule-job-items-pipeline.sql e valida coluna pipeline.
 */
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
    let value = trimmed.slice(eq + 1);
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (value && value.length > 0) {
      env[trimmed.slice(0, eq)] = value;
    }
  }
  return env;
}

const ENV_FILES = [
  ".env.local",
  ".env.vercel.tmp",
  ".env.production.tmp",
  ".env.local.production",
  ".env.vercel.prod",
  ".env.vercel.audit",
  ".env.vercel.runtime",
];

const env = {
  ...ENV_FILES.reduce(
    (acc, file) => ({ ...acc, ...loadEnv(path.join(process.cwd(), file)) }),
    {},
  ),
  ...process.env,
};

const sql = fs.readFileSync(
  path.join(process.cwd(), "supabase/schedule-job-items-pipeline.sql"),
  "utf8",
);

const connectionString =
  env.DATABASE_URL || env.SUPABASE_DB_URL || env.POSTGRES_URL || env.SUPABASE_DATABASE_URL;
const accessToken = env.SUPABASE_ACCESS_TOKEN;
const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL;

if (!connectionString && !(accessToken && supabaseUrl)) {
  console.error("Need DATABASE_URL or SUPABASE_ACCESS_TOKEN + NEXT_PUBLIC_SUPABASE_URL");
  process.exit(1);
}

async function runSql(query) {
  if (connectionString) {
    const pg = await import("pg");
    const client = new pg.default.Client({ connectionString, ssl: { rejectUnauthorized: false } });
    await client.connect();
    try {
      return await client.query(query);
    } finally {
      await client.end();
    }
  }
  const projectRef = new URL(supabaseUrl).hostname.split(".")[0];
  const res = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query }),
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`Management API ${res.status}: ${body}`);
  return JSON.parse(body);
}

console.log("Applying pipeline migration…");
await runSql(sql);
console.log("Migration applied.");

const verify = await runSql(`
  select column_name, data_type
  from information_schema.columns
  where table_name = 'schedule_job_items'
    and column_name = 'pipeline';
`);

const rows = verify.rows ?? verify;
const row = Array.isArray(rows) ? rows[0] : rows?.[0];
if (!row || row.column_name !== "pipeline" || row.data_type !== "jsonb") {
  console.error("Validation failed:", JSON.stringify(rows));
  process.exit(1);
}
console.log("Validated: pipeline | jsonb");
