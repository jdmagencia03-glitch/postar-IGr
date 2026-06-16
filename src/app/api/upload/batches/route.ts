import { NextRequest, NextResponse } from "next/server";
import { getOwnerAccountById } from "@/lib/accounts";
import { formatZodError } from "@/lib/api-errors";
import { MAX_VIDEOS_TOTAL } from "@/lib/autopilot-constants";
import { getOwnerTikTokAccountById } from "@/lib/tiktok/accounts";
import {
  buildStoragePath,
  getActiveBatchForOwner,
  getBatchForOwner,
  refreshBatchCounters,
} from "@/lib/upload/batches";
import { getSessionUserId } from "@/lib/meta/oauth";
import { createAdminClient } from "@/lib/supabase/admin";
import { z } from "zod";

const createSchema = z
  .object({
    platform: z.enum(["instagram", "tiktok"]).default("instagram"),
    account_id: z.string().uuid().optional(),
    tiktok_account_id: z.string().uuid().optional(),
    schedule_mode: z.enum(["today", "auto", "warmup", "custom"]).default("auto"),
  custom_schedule: z
    .object({
      posts_per_day: z.number().int().min(1).max(100),
      time_slots: z.array(z.string()).max(48).optional(),
      start_time: z.string().optional(),
      end_time: z.string().optional(),
    })
    .optional(),
  files: z
    .array(
      z.object({
        filename: z.string().min(1).max(500),
        file_size: z.number().int().positive(),
        content_type: z.string().max(120).optional(),
        file_hash: z.string().max(500).optional(),
        last_modified: z.number().int().optional(),
      }),
    )
    .min(1)
    .max(MAX_VIDEOS_TOTAL),
  upload_speed_mode: z.enum(["economy", "normal", "turbo"]).optional(),
  })
  .refine(
    (data) =>
      (data.platform === "instagram" && Boolean(data.account_id)) ||
      (data.platform === "tiktok" && Boolean(data.tiktok_account_id)),
    { message: "Conta obrigatória para a plataforma selecionada" },
  );

export async function GET() {
  const ownerId = await getSessionUserId();
  if (!ownerId) {
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  }

  const supabase = createAdminClient();
  const batch = await getActiveBatchForOwner(supabase, ownerId);

  return NextResponse.json({ batch });
}

export async function POST(request: NextRequest) {
  const ownerId = await getSessionUserId();
  if (!ownerId) {
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  }

  const body = await request.json();
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: formatZodError(parsed.error) }, { status: 400 });
  }

  const supabase = createAdminClient();
  const platform = parsed.data.platform;

  if (platform === "tiktok") {
    const tiktokAccount = await getOwnerTikTokAccountById(
      supabase,
      ownerId,
      parsed.data.tiktok_account_id!,
    );
    if (!tiktokAccount) {
      return NextResponse.json({ error: "Conta TikTok não encontrada" }, { status: 404 });
    }
  } else {
    const account = await getOwnerAccountById(supabase, ownerId, parsed.data.account_id!);
    if (!account) {
      return NextResponse.json({ error: "Conta não encontrada" }, { status: 404 });
    }
  }

  const existing = await getActiveBatchForOwner(supabase, ownerId);
  if (existing) {
    return NextResponse.json(
      {
        error:
          "Já existe um lote em andamento. Retome o upload anterior ou cancele-o antes de criar outro.",
        batch: existing,
      },
      { status: 409 },
    );
  }

  const { data: batch, error: batchError } = await supabase
    .from("upload_batches")
    .insert({
      owner_id: ownerId,
      platform,
      account_id: platform === "instagram" ? parsed.data.account_id! : null,
      tiktok_account_id: platform === "tiktok" ? parsed.data.tiktok_account_id! : null,
      schedule_mode: parsed.data.schedule_mode,
      custom_schedule: parsed.data.custom_schedule ?? null,
      upload_speed_mode: parsed.data.upload_speed_mode ?? "normal",
      status: "uploading",
      started_at: new Date().toISOString(),
      total_files: parsed.data.files.length,
    })
    .select("*")
    .single();

  if (batchError || !batch) {
    return NextResponse.json({ error: batchError?.message ?? "Falha ao criar lote" }, { status: 500 });
  }

  const fileRows = parsed.data.files.map((file, index) => {
    const fileId = crypto.randomUUID();
    return {
      id: fileId,
      batch_id: batch.id,
      filename: file.filename,
      file_size: file.file_size,
      content_type: file.content_type || "video/mp4",
      storage_path: buildStoragePath(ownerId, batch.id, fileId, file.filename),
      file_hash: file.file_hash ?? null,
      last_modified: file.last_modified ?? null,
      sort_order: index,
      status: "pending",
    };
  });

  const { data: files, error: filesError } = await supabase
    .from("upload_files")
    .insert(fileRows)
    .select("*");

  if (filesError) {
    await supabase.from("upload_batches").delete().eq("id", batch.id);
    return NextResponse.json({ error: filesError.message }, { status: 500 });
  }

  return NextResponse.json({
    batch: {
      ...batch,
      upload_files: files,
    },
  });
}
