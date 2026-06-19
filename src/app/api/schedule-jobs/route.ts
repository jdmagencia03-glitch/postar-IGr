import { formatZodError } from "@/lib/api-errors";
import { NextRequest, NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/meta/oauth";
import { createScheduleJob, findActiveJobForBatch } from "@/lib/schedule-jobs/repository";
import { SCHEDULE_JOB_LARGE_BATCH_THRESHOLD } from "@/lib/schedule-jobs/constants";
import { getBatchForOwner } from "@/lib/upload/batches";
import { createAdminClient } from "@/lib/supabase/admin";
import type { ScheduleJobConfig } from "@/lib/schedule-jobs/types";
import { z } from "zod";

const createSchema = z.object({
  upload_batch_id: z.string().uuid(),
  targets: z
    .array(
      z.object({
        platform: z.enum(["instagram", "tiktok"]),
        account_id: z.string().uuid(),
      }),
    )
    .min(1)
    .max(2),
  schedule_mode: z.enum(["today", "auto", "warmup", "custom"]).default("auto"),
  custom_schedule: z
    .object({
      posts_per_day: z.number().int().min(1).max(100),
      time_slots: z.array(z.string()).max(48).optional(),
      start_time: z.string().optional(),
      end_time: z.string().optional(),
    })
    .optional(),
  schedule_strategy: z.enum(["continue", "new_plan", "fill_gaps"]).optional(),
  batch_scheduled_count: z.number().int().min(0).optional(),
  product_id: z.string().uuid().optional().nullable(),
  campaign_id: z.string().uuid().optional().nullable(),
  content_objective: z.string().max(200).optional().nullable(),
  auto_profile: z.enum(["new", "growing", "strong"]).optional(),
  partial: z.boolean().optional(),
});

export async function POST(request: NextRequest) {
  try {
    const ownerId = await getSessionUserId();
    if (!ownerId) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

    const parsed = createSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: formatZodError(parsed.error) }, { status: 400 });
    }

    const supabase = createAdminClient();
    const batch = await getBatchForOwner(supabase, ownerId, parsed.data.upload_batch_id);

    if (!batch) {
      return NextResponse.json({ error: "Lote não encontrado" }, { status: 404 });
    }

    const files = (batch.upload_files ?? [])
      .filter((file) => file.status === "completed" && file.public_url && !file.removed)
      .sort((a, b) => a.sort_order - b.sort_order);

    if (!files.length) {
      return NextResponse.json({ error: "Nenhum vídeo enviado para agendar." }, { status: 400 });
    }

    const existing = await findActiveJobForBatch(supabase, ownerId, batch.id);
    if (existing) {
      return NextResponse.json({
        jobId: existing.id,
        reused: true,
        total: existing.total_items,
        largeBatch: files.length >= SCHEDULE_JOB_LARGE_BATCH_THRESHOLD,
        message: "Job de agendamento já em andamento — retomando progresso salvo.",
      });
    }

    const platforms = new Set(parsed.data.targets.map((t) => t.platform));
    const platform =
      platforms.size > 1 ? "both" : parsed.data.targets[0]!.platform;

    const config: ScheduleJobConfig = {
      targets: parsed.data.targets,
      schedule_mode: parsed.data.schedule_mode,
      custom_schedule: parsed.data.custom_schedule,
      schedule_strategy: parsed.data.schedule_strategy,
      batch_scheduled_count: parsed.data.batch_scheduled_count ?? 0,
      product_id: parsed.data.product_id,
      campaign_id: parsed.data.campaign_id,
      content_objective: parsed.data.content_objective,
      auto_profile: parsed.data.auto_profile,
    };

    const igTarget = parsed.data.targets.find((t) => t.platform === "instagram");
    const ttTarget = parsed.data.targets.find((t) => t.platform === "tiktok");

    const created = await createScheduleJob(supabase, {
      ownerId,
      uploadBatchId: batch.id,
      accountId: igTarget?.account_id ?? null,
      tiktokAccountId: ttTarget?.account_id ?? null,
      platform,
      config,
      items: files.map((file) => ({
        uploadFileId: file.id,
        sortOrder: file.sort_order,
        filename: file.filename,
        mediaUrls: [file.public_url as string],
      })),
    });

    return NextResponse.json(
      {
        jobId: created.job.id,
        total: created.job.total_items,
        largeBatch: files.length >= SCHEDULE_JOB_LARGE_BATCH_THRESHOLD,
        message:
          files.length >= SCHEDULE_JOB_LARGE_BATCH_THRESHOLD
            ? "Lote grande detectado. Processando agendamento em segundo plano para evitar falhas."
            : "Agendamento iniciado em segundo plano.",
      },
      { status: 201 },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha ao criar agendamento";
    const hint = /schedule_jobs|schedule_job_items|does not exist|relation|foreign key|owner_id_fkey/i.test(
      message,
    )
      ? " Execute supabase/schedule-jobs-fix-owner.sql no Supabase (owner_id deve ser text, não auth.users)."
      : "";
    return NextResponse.json({ error: `${message}${hint}` }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  try {
    const ownerId = await getSessionUserId();
    if (!ownerId) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

    const batchId = request.nextUrl.searchParams.get("upload_batch_id");
    if (!batchId) {
      return NextResponse.json({ error: "upload_batch_id obrigatório" }, { status: 400 });
    }

    const supabase = createAdminClient();
    const job = await findActiveJobForBatch(supabase, ownerId, batchId);

    return NextResponse.json({ jobId: job?.id ?? null });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Falha ao buscar job" },
      { status: 500 },
    );
  }
}
