/**
 * Exporta tabelas críticas para JSON antes de migration/deploy.
 * Uso: node scripts/backup-prod-tables.mjs [output-dir]
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

const TABLES = [
  "schedule_jobs",
  "schedule_job_items",
  "schedule_job_tasks",
  "scheduled_posts",
  "instagram_accounts",
  "tiktok_accounts",
];

const outDir =
  process.argv[2] ??
  path.join(process.cwd(), "backups", `pre-pipeline-${new Date().toISOString().replace(/[:.]/g, "-")}`);

const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
const connectionString =
  env.DATABASE_URL || env.SUPABASE_DB_URL || env.POSTGRES_URL || env.SUPABASE_DATABASE_URL;

async function backupViaRest() {
  if (!supabaseUrl || !serviceKey) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }
  fs.mkdirSync(outDir, { recursive: true });
  const manifest = { createdAt: new Date().toISOString(), method: "rest", tables: {} };

  for (const table of TABLES) {
    const rows = [];
    const pageSize = 1000;
    let offset = 0;
    const order = ["schedule_jobs", "schedule_job_items", "scheduled_posts"].includes(table)
      ? "created_at.asc"
      : "id.asc";
    for (;;) {
      const res = await fetch(
        `${supabaseUrl}/rest/v1/${table}?select=*&order=${order}&offset=${offset}&limit=${pageSize}`,
        {
          headers: {
            apikey: serviceKey,
            Authorization: `Bearer ${serviceKey}`,
            Prefer: "count=exact",
          },
        },
      );
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`${table} REST ${res.status}: ${text.slice(0, 300)}`);
      }
      const batch = await res.json();
      if (!Array.isArray(batch) || batch.length === 0) break;
      rows.push(...batch);
      if (batch.length < pageSize) break;
      offset += pageSize;
    }
    const file = path.join(outDir, `${table}.json`);
    fs.writeFileSync(file, JSON.stringify(rows, null, 2));
    manifest.tables[table] = { rows: rows.length, file: path.basename(file) };
    console.log(`✓ ${table}: ${rows.length} rows`);
  }

  fs.writeFileSync(path.join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2));
  fs.writeFileSync(
    path.join(outDir, "RESTORE.md"),
    `# Restauração manual

Backup em: ${outDir}

Cada tabela está em \`<table>.json\`. Para restaurar linhas específicas, use o SQL Editor ou:

\`\`\`bash
# Exemplo com psql (ajuste connection string):
# psql "$DATABASE_URL" -c "COPY schedule_jobs FROM STDIN" < schedule_jobs.json
\`\`\`

**Rollback de deploy:** reverter Vercel para commit \`d766722\` — a coluna \`pipeline\` pode permanecer (compatível).

**Não apague** posts já publicados no TikTok/Instagram.
`,
  );
  return outDir;
}

async function backupViaPg() {
  const pg = await import("pg");
  const client = new pg.default.Client({ connectionString, ssl: { rejectUnauthorized: false } });
  await client.connect();
  fs.mkdirSync(outDir, { recursive: true });
  const manifest = { createdAt: new Date().toISOString(), method: "postgres", tables: {} };

  try {
    for (const table of TABLES) {
      const { rows } = await client.query(`select * from ${table}`);
      const file = path.join(outDir, `${table}.json`);
      fs.writeFileSync(file, JSON.stringify(rows, null, 2));
      manifest.tables[table] = { rows: rows.length, file: path.basename(file) };
      console.log(`✓ ${table}: ${rows.length} rows`);
    }
    fs.writeFileSync(path.join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2));
  } finally {
    await client.end();
  }
  return outDir;
}

try {
  let dir;
  if (connectionString) {
    console.log("Backing up via Postgres…");
    dir = await backupViaPg();
  } else {
    console.log("Backing up via Supabase REST…");
    dir = await backupViaRest();
  }
  console.log(`\nBackup salvo em: ${dir}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
