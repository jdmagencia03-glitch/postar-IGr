import { NextRequest, NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/meta/oauth";
import {
  operationalErrorFiltersSchema,
  operationalErrorReportSchema,
} from "@/lib/api/schemas/operations";
import { parseJsonBody, parseSearchParams } from "@/lib/api/validate-request";
import {
  listOperationalErrors,
  reportClientOperationalError,
} from "@/lib/operations/operational-errors";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const ownerId = await getSessionUserId();
  if (!ownerId) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const filters = parseSearchParams(request.nextUrl.searchParams, operationalErrorFiltersSchema);
  if (!filters.ok) return filters.response;

  const supabase = createAdminClient();
  try {
    const result = await listOperationalErrors(supabase, ownerId, filters.data);
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

  const parsed = await parseJsonBody(request, operationalErrorReportSchema);
  if (!parsed.ok) return parsed.response;

  const supabase = createAdminClient();
  try {
    const detected = await reportClientOperationalError(supabase, ownerId, {
      errorType: parsed.data.errorType ?? "client_report",
      title: parsed.data.title,
      message: parsed.data.message ?? "",
      technicalMessage: parsed.data.technicalMessage,
      probableCause: parsed.data.probableCause ?? "Detectado pelo cliente.",
      recommendedAction: parsed.data.recommendedAction ?? "Atualize a página ou abra o lote.",
      severity: parsed.data.severity,
      status: parsed.data.status,
      category: parsed.data.category,
      accountId: parsed.data.accountId,
      platform: parsed.data.platform,
      uploadBatchId: parsed.data.uploadBatchId,
      uploadFileId: parsed.data.uploadFileId,
      metadata: parsed.data.metadata,
    });
    return NextResponse.json({ ok: true, fingerprint: detected.fingerprint });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Falha ao registrar erro" },
      { status: 500 },
    );
  }
}
