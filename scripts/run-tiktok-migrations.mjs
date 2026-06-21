/**
 * Aplica migrações TikTok no Supabase (idempotente).
 * Usage: node scripts/run-tiktok-migrations.mjs
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

const MIGRATIONS = [
  "supabase/tiktok-accounts.sql",
  "supabase/tiktok-posts.sql",
  "supabase/tiktok-upload-batches.sql",
  "supabase/tiktok-integration-enhance.sql",
  "supabase/operations-phase3.sql",
];

async function checkColumn(table, column) {
  const res = await fetch(
    `${supabaseUrl}/rest/v1/${table}?select=${column}&limit=0`,
    {
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
      },
    },
  );
  if (res.ok) return true;
  const text = await res.text();
  return !text.includes("42703") && !text.includes("does not exist");
}

async function checkTable(table) {
  const res = await fetch(`${supabaseUrl}/rest/v1/${table}?select=id&limit=1`, {
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
    },
  });
  if (res.ok) return true;
  const text = await res.text();
  return !text.includes("PGRST205") && !text.includes("does not exist");
}

async function runSql(sql) {
  const projectRef = new URL(supabaseUrl).hostname.split(".")[0];
  const accessToken = env.SUPABASE_ACCESS_TOKEN;
  if (accessToken) {
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
    return;
  }

  const connectionString =
    env.DATABASE_URL || env.SUPABASE_DB_URL || env.POSTGRES_URL || env.SUPABASE_DATABASE_URL;
  if (!connectionString) {
    throw new Error("Set SUPABASE_ACCESS_TOKEN or DATABASE_URL to apply SQL");
  }

  const pg = await import("pg");
  const client = new pg.default.Client({ connectionString, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    await client.query(sql);
  } finally {
    await client.end();
  }
}

console.log("Checking TikTok schema…");

const needs = {
  tiktok_accounts: !(await checkTable("tiktok_accounts")),
  platform: !(await checkColumn("scheduled_posts", "platform")),
  tiktok_account_id_posts: !(await checkColumn("scheduled_posts", "tiktok_account_id")),
  upload_platform: !(await checkColumn("upload_batches", "platform")),
  provider_publish_id: !(await checkColumn("scheduled_posts", "provider_publish_id")),
  publishing_paused: !(await checkColumn("tiktok_accounts", "publishing_paused")),
};

console.log("Missing:", Object.entries(needs).filter(([, v]) => v).map(([k]) => k).join(", ") || "none");

if (!Object.values(needs).some(Boolean)) {
  console.log("TikTok migrations already applied.");
  process.exit(0);
}

for (const file of MIGRATIONS) {
  const fullPath = path.resolve(file);
  if (!fs.existsSync(fullPath)) {
    console.warn("Skip missing file:", file);
    continue;
  }
  console.log("Applying", file, "…");
  const sql = fs.readFileSync(fullPath, "utf8");
  await runSql(sql);
  console.log("OK:", file);
}

console.log("TikTok migrations complete.");
