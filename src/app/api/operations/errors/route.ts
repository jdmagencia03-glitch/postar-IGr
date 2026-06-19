import { NextRequest, NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/meta/oauth";
import {
  listOperationalErrors,
  reportClientOperationalError,
  type OperationalErrorFilters,
} from "@/lib/operations/operational-errors";
import { createAdminClient } from "@/lib/supabase/admin";
import type {
  OperationalErrorCategory,
  OperationalErrorSeverity,
  OperationalErrorStatus,
} from "@/lib/types";

export const dynamic = "force-dynamic";

function parseFilters(searchParams: URLSearchParams): OperationalErrorFilters {
  return {
    severity: (searchParams.get("severity") as OperationalErrorSeverity | "all") ?? "all",
    status: (searchParams.get("status") as OperationalErrorStatus | "all" | "open_active") ?? "open_active",
    category: (searchParams.get("category") as OperationalErrorCategory | "all") ?? "all",
    accountId: searchParams.get("accountId") ?? undefined,
    platform: searchParams.get("platform") ?? undefined,
    dateFrom: searchParams.get("dateFrom") ?? undefined,
    dateTo: searchParams.get("dateTo") ?? undefined,
    q: searchParams.get("q") ?? undefined,
  };
}

export async function GET(request: NextRequest) {
  const ownerId = await getSessionUserId();
  if (!ownerId) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const supabase = createAdminClient();
  try {
    const result = await listOperationalErrors(supabase, ownerId, parseFilters(request.nextUrl.searchParams));
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Falha ao listar erros" },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  const ownerId = await getSessionUserId();
  if (!ownerId) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const supabase = createAdminClient();
  try {
    const detected = await reportClientOperationalError(supabase, ownerId, {
      errorType: String(body.errorType ?? "client_report"),
      title: String(body.title ?? "Erro reportado"),
      message: String(body.message ?? ""),
      technicalMessage: body.technicalMessage ? String(body.technicalMessage) : undefined,
      probableCause: String(body.probableCause ?? "Detectado pelo cliente."),
      recommendedAction: String(body.recommendedAction ?? "Atualize a página ou abra o lote."),
      severity: body.severity as OperationalErrorSeverity | undefined,
      status: body.status as OperationalErrorStatus | undefined,
      category: body.category as OperationalErrorCategory | undefined,
      accountId: body.accountId ? String(body.accountId) : undefined,
      platform: body.platform as "instagram" | "tiktok" | undefined,
      uploadBatchId: body.uploadBatchId ? String(body.uploadBatchId) : undefined,
      uploadFileId: body.uploadFileId ? String(body.uploadFileId) : undefined,
      metadata: (body.metadata as Record<string, unknown>) ?? undefined,
    });
    return NextResponse.json({ ok: true, fingerprint: detected.fingerprint });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Falha ao registrar erro" },
      { status: 500 },
    );
  }
}
