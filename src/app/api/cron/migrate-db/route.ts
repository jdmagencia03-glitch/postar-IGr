import fs from "node:fs";
import path from "node:path";
import { Client } from "pg";
import { NextRequest, NextResponse } from "next/server";
import { getCronSecret } from "@/lib/security/secrets";
import { resetScheduleJobQueueSchemaCache } from "@/lib/schedule-jobs/queue/schema";
import { resolveDatabaseUrl } from "@/lib/supabase/database-url";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function unauthorized() {
  return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
}

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  let cronSecret: string;
  try {
    cronSecret = getCronSecret();
  } catch {
    return NextResponse.json({ ok: false, error: "CRON_SECRET not configured" }, { status: 503 });
  }

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return unauthorized();
  }

  const databaseUrl = resolveDatabaseUrl();
  if (!databaseUrl) {
    return NextResponse.json(
      {
        ok: false,
        error: "missing_db_credentials",
        message:
          "Configure DATABASE_URL ou SUPABASE_DB_PASSWORD na Vercel, ou execute supabase/schedule-jobs-queue.sql no SQL Editor.",
      },
      { status: 503 },
    );
  }

  const migrationName = request.nextUrl.searchParams.get("migration") ?? "schedule-jobs-queue";
  const sqlPath = path.join(process.cwd(), "supabase", `${migrationName}.sql`);
  if (!fs.existsSync(sqlPath)) {
    return NextResponse.json({ ok: false, error: "migration_not_found", migration: migrationName }, { status: 404 });
  }

  const sql = fs.readFileSync(sqlPath, "utf8");
  const client = new Client({
    connectionString: databaseUrl,
    ssl: { rejectUnauthorized: false },
  });

  try {
    await client.connect();
    await client.query(sql);
    resetScheduleJobQueueSchemaCache();
    return NextResponse.json({
      ok: true,
      migration: migrationName,
      message: "Migration applied successfully",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Migration failed";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  } finally {
    await client.end().catch(() => undefined);
  }
}
