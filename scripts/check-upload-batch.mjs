import { readFileSync } from "fs";
import { createClient } from "@supabase/supabase-js";

const envFile = process.argv[2] ?? ".env.local.production";
const env = readFileSync(envFile, "utf8");
for (const line of env.split("\n")) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) continue;
  const eq = trimmed.indexOf("=");
  if (eq <= 0) continue;
  const name = trimmed.slice(0, eq);
  let value = trimmed.slice(eq + 1);
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }
  process.env[name] = value;
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Missing Supabase credentials");
  process.exit(1);
}

const supabase = createClient(url, key);

const { data: batches, error } = await supabase
  .from("upload_batches")
  .select(
    "id, status, total_files, completed_files, failed_files, paused, created_at, updated_at, instagram_accounts(ig_username)",
  )
  .in("status", ["uploading", "ready"])
  .order("updated_at", { ascending: false })
  .limit(5);

if (error) {
  console.error(error.message);
  process.exit(1);
}

if (!batches?.length) {
  console.log(JSON.stringify({ message: "Nenhum lote ativo (uploading/ready) encontrado." }, null, 2));
  process.exit(0);
}

const results = [];
for (const batch of batches) {
  const statuses = ["completed", "pending", "uploading", "failed"];
  const fileCounts = {};
  for (const status of statuses) {
    const { count } = await supabase
      .from("upload_files")
      .select("id", { count: "exact", head: true })
      .eq("batch_id", batch.id)
      .or("removed.is.null,removed.eq.false")
      .eq("status", status);
    fileCounts[status] = count ?? 0;
  }

  const { count: total } = await supabase
    .from("upload_files")
    .select("id", { count: "exact", head: true })
    .eq("batch_id", batch.id)
    .or("removed.is.null,removed.eq.false");

  const { data: staleUploading } = await supabase
    .from("upload_files")
    .select("filename, status, bytes_uploaded, file_size, updated_at")
    .eq("batch_id", batch.id)
    .eq("status", "uploading")
    .or("removed.is.null,removed.eq.false")
    .order("updated_at", { ascending: true })
    .limit(5);

  results.push({
    batchId: batch.id,
    account: batch.instagram_accounts?.ig_username ?? null,
    batchStatus: batch.status,
    paused: batch.paused,
    countersOnBatch: {
      total: batch.total_files,
      completed: batch.completed_files,
      failed: batch.failed_files,
    },
    fileCounts: { ...fileCounts, total: total ?? 0 },
    pendingPlusUploading: (fileCounts.pending ?? 0) + (fileCounts.uploading ?? 0),
    staleUploadingSample: staleUploading ?? [],
    createdAt: batch.created_at,
    updatedAt: batch.updated_at,
  });
}

console.log(JSON.stringify(results, null, 2));
