import { NextRequest, NextResponse } from "next/server";
import { getOwnerAccountById } from "@/lib/accounts";
import { formatZodError } from "@/lib/api-errors";
import { BATCH_CREATE_CHUNK_SIZE, MAX_VIDEOS_TOTAL } from "@/lib/autopilot-constants";
import { getOwnerTikTokAccountById } from "@/lib/tiktok/accounts";
import {
  buildUploadFileRows,
  getActiveBatchForOwner,
  getActiveBatchSummaryForOwner,
  getBatchFileStatusCounts,
  getUploadingBatchForOwner,
  insertUploadFiles,
} from "@/lib/upload/batches";
import { getSessionUserId } from "@/lib/meta/oauth";
import { createAdminClient } from "@/lib/supabase/admin";
import { z } from "zod";

const fileInputSchema = z.object({
  filename: z.string().min(1).max(500),
  file_size: z.number().int().positive(),
  content_type: z.string().max(120).optional(),
  file_hash: z.string().max(500).optional(),
  last_modified: z.number().int().optional(),
});

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
      .array(fileInputSchema)
      .min(1)
      .max(BATCH_CREATE_CHUNK_SIZE, {
        message: `Envie no máximo ${BATCH_CREATE_CHUNK_SIZE} vídeos por requisição.`,
      }),
    total_files: z.number().int().min(1).max(MAX_VIDEOS_TOTAL).optional(),
    upload_speed_mode: z.enum(["economy", "normal", "turbo"]).optional(),
  })
  .refine(
    (data) =>
      (data.platform === "instagram" && Boolean(data.account_id)) ||
      (data.platform === "tiktok" && Boolean(data.tiktok_account_id)),
    { message: "Conta obrigatória para a plataforma selecionada" },
  )
  .refine((data) => (data.total_files ?? data.files.length) <= MAX_VIDEOS_TOTAL, {
    message: `Máximo de ${MAX_VIDEOS_TOTAL} vídeos por lote.`,
    path: ["total_files"],
  });

export async function GET(request: NextRequest) {
  const ownerId = await getSessionUserId();
  if (!ownerId) {
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  }

  const summaryOnly = request.nextUrl.searchParams.get("summary") === "1";
  const platformParam = request.nextUrl.searchParams.get("platform");
  const accountId = request.nextUrl.searchParams.get("account_id");
  const accountScope =
    platformParam && accountId && (platformParam === "instagram" || platformParam === "tiktok")
      ? { platform: platformParam as "instagram" | "tiktok", accountId }
      : undefined;

  const supabase = createAdminClient();
  const batch = summaryOnly
    ? await getActiveBatchSummaryForOwner(supabase, ownerId, accountScope)
    : await getActiveBatchForOwner(supabase, ownerId, accountScope);

  if (!batch) {
    return NextResponse.json({ batch: null });
  }

  const fileCounts = await getBatchFileStatusCounts(supabase, batch.id);

  return NextResponse.json({
    batch,
    fileCounts,
    pendingTotal: fileCounts.pending + fileCounts.uploading,
  });
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

  const existing = await getUploadingBatchForOwner(supabase, ownerId);
  if (existing) {
    return NextResponse.json(
      {
        error:
          "Já existe um upload em andamento. Retome o upload anterior ou cancele-o antes de criar outro.",
        batch: existing,
      },
      { status: 409 },
    );
  }

  const totalFiles = parsed.data.total_files ?? parsed.data.files.length;

  const { data: batch, error: batchError } = await supabase
    .from("upload_batches")
    .insert({
      owner_id: ownerId,
      platform,
      account_id: platform === "instagram" ? parsed.data.account_id! : null,
      tiktok_account_id: platform === "tiktok" ? parsed.data.tiktok_account_id! : null,
      schedule_mode: parsed.data.schedule_mode,
      custom_schedule: parsed.data.custom_schedule ?? null,
      upload_speed_mode: parsed.data.upload_speed_mode ?? "turbo",
      status: "uploading",
      started_at: new Date().toISOString(),
      total_files: totalFiles,
    })
    .select("*")
    .single();

  if (batchError || !batch) {
    return NextResponse.json({ error: batchError?.message ?? "Falha ao criar lote" }, { status: 500 });
  }

  try {
    const fileRows = buildUploadFileRows(ownerId, batch.id, parsed.data.files);
    const files = await insertUploadFiles(supabase, fileRows);

    return NextResponse.json({
      batch: {
        ...batch,
        upload_files: files,
      },
    });
  } catch (error) {
    await supabase.from("upload_batches").delete().eq("id", batch.id);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Falha ao registrar arquivos" },
      { status: 500 },
    );
  }
}
