/**
 * Adiciona DATABASE_URL (ou SUPABASE_DB_PASSWORD) na Vercel Production.
 * Não imprime o valor da connection string.
 *
 * Usage:
 *   DATABASE_URL="postgresql://..." node scripts/set-vercel-database-url.mjs
 *   SUPABASE_DB_PASSWORD="..." node scripts/set-vercel-database-url.mjs
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline/promises";

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

function resolveDatabaseUrl(env) {
  const direct =
    env.DATABASE_URL?.trim() ||
    env.SUPABASE_DB_URL?.trim() ||
    env.POSTGRES_URL?.trim();
  if (direct) return { mode: "DATABASE_URL", value: direct };

  const password = env.SUPABASE_DB_PASSWORD?.trim();
  const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  if (password && supabaseUrl) {
    const projectRef = new URL(supabaseUrl).hostname.split(".")[0];
    const region = env.SUPABASE_DB_REGION?.trim() || "us-east-1";
    const value = `postgresql://postgres.${projectRef}:${encodeURIComponent(password)}@aws-0-${region}.pooler.supabase.com:6543/postgres?sslmode=require`;
    return { mode: "SUPABASE_DB_PASSWORD", value };
  }

  return null;
}

async function promptHidden(label) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  const value = await rl.question(`${label}: `);
  rl.close();
  return value.trim();
}

const env = {
  ...loadEnv(path.join(process.cwd(), ".env.local")),
  ...process.env,
};

let resolved = resolveDatabaseUrl(env);

if (!resolved) {
  console.log("DATABASE_URL não encontrada. Cole a connection string do Supabase (Database → URI).");
  const value = await promptHidden("DATABASE_URL");
  if (!value) {
    console.error("Valor vazio — abortado.");
    process.exit(1);
  }
  resolved = { mode: "DATABASE_URL", value };
}

const varName = resolved.mode === "SUPABASE_DB_PASSWORD" ? "SUPABASE_DB_PASSWORD" : "DATABASE_URL";
const varValue =
  resolved.mode === "SUPABASE_DB_PASSWORD"
    ? env.SUPABASE_DB_PASSWORD.trim()
    : resolved.value;

console.log(`Configurando ${varName} em Production (valor oculto)...`);

const result = spawnSync(
  "npx",
  ["vercel", "env", "add", varName, "production", "--value", varValue, "--yes", "--force"],
  { stdio: "inherit", shell: true, cwd: process.cwd() },
);

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

console.log(`OK. Rode: npx vercel --prod`);
console.log("Depois confira atomicApplyReady via POST /api/admin/fix-schedule-times/inspect");
