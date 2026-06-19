import { formatZodError } from "@/lib/api-errors";
import { NextRequest, NextResponse } from "next/server";
import {
  deleteUploadBatchForOwner,
  getBatchForOwner,
  getBatchFileStatusCounts,
} from "@/lib/upload/batches";
import { getSessionUserId } from "@/lib/meta/oauth";
import { createAdminClient } from "@/lib/supabase/admin";
import { z } from "zod";

const patchSchema = z.object({
  paused: z.boolean().optional(),
  upload_speed_mode: z.enum(["economy", "normal", "turbo", "adaptive"]).optional(),
  schedule_mode: z.enum(["today", "auto", "warmup", "custom"]).optional(),
  custom_schedule: z
    .object({
      posts_per_day: z.number().int().min(1).max(100),
      time_slots: z.array(z.string()).max(48).optional(),
      start_time: z.string().optional(),
      end_time: z.string().optional(),
    })
    .nullable()
    .optional(),
});

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const ownerId = await getSessionUserId();
  if (!ownerId) {
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  }

  const { id } = await context.params;
  const supabase = createAdminClient();
  const batch = await getBatchForOwner(supabase, ownerId, id);

  if (!batch) {
    return NextResponse.json({ error: "Lote não encontrado" }, { status: 404 });
  }

  const fileCounts = await getBatchFileStatusCounts(supabase, id);

  return NextResponse.json({
    batch,
    fileCounts,
    pendingTotal: fileCounts.pending + fileCounts.uploading,
  });
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const ownerId = await getSessionUserId();
  if (!ownerId) {
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  }

  const { id } = await context.params;
  const body = await request.json();
  const parsed = patchSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: formatZodError(parsed.error) }, { status: 400 });
  }

  const supabase = createAdminClient();
  const batch = await getBatchForOwner(supabase, ownerId, id);

  if (!batch) {
    return NextResponse.json({ error: "Lote não encontrado" }, { status: 404 });
  }

  if (batch.status === "cancelled") {
    return NextResponse.json({ error: "Lote cancelado" }, { status: 409 });
  }

  const { data, error } = await supabase
    .from("upload_batches")
    .update({
      ...parsed.data,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .select("*, instagram_accounts(ig_username)")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const refreshed = await getBatchForOwner(supabase, ownerId, id);
  return NextResponse.json({ batch: refreshed ?? data });
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const ownerId = await getSessionUserId();
  if (!ownerId) {
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  }

  const { id } = await context.params;
  const supabase = createAdminClient();
  const batch = await getBatchForOwner(supabase, ownerId, id);

  if (!batch) {
    return NextResponse.json({ error: "Lote não encontrado" }, { status: 404 });
  }

  const permanent = request.nextUrl.searchParams.get("permanent") === "1";

  if (permanent) {
    try {
      const result = await deleteUploadBatchForOwner(supabase, ownerId, id);
      if (!result) {
        return NextResponse.json({ error: "Lote não encontrado" }, { status: 404 });
      }
      return NextResponse.json({ success: true, ...result });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Falha ao apagar lote";
      return NextResponse.json({ error: message }, { status: 400 });
    }
  }

  const { error } = await supabase
    .from("upload_batches")
    .update({
      status: "cancelled",
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
