import { formatZodError } from "@/lib/api-errors";
import { NextRequest, NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/meta/oauth";
import { bulkDeleteOwnerPosts } from "@/lib/posts/bulk-delete";
import { createAdminClient } from "@/lib/supabase/admin";
import { z } from "zod";

export const maxDuration = 60;

const bodySchema = z.object({
  postIds: z.array(z.string().uuid()).min(1).max(5000),
  ignorePublished: z.boolean().optional(),
});

function isBulkDeleteDebugEnabled() {
  return process.env.NODE_ENV === "development" || process.env.BULK_DELETE_DEBUG === "1";
}

/** Exclusão em massa de posts da fila/calendário (ignora publicados por padrão). */
export async function POST(request: NextRequest) {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ ok: false, error: "Não autenticado" }, { status: 401 });
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: formatZodError(parsed.error) },
      { status: 400 },
    );
  }

  if (isBulkDeleteDebugEnabled()) {
    console.info("[bulk_delete_started]", {
      count: parsed.data.postIds.length,
      ignorePublished: parsed.data.ignorePublished ?? true,
    });
  }

  try {
    const supabase = createAdminClient();
    const result = await bulkDeleteOwnerPosts(
      supabase,
      userId,
      parsed.data.postIds,
      { ignorePublished: parsed.data.ignorePublished ?? true },
    );

    if (isBulkDeleteDebugEnabled()) {
      console.info("[bulk_delete_response]", result);
    }

    if (result.failed > 0 && result.deleted === 0) {
      return NextResponse.json(
        {
          ...result,
          error: "Não foi possível excluir os posts. Tente novamente.",
        },
        { status: 500 },
      );
    }

    return NextResponse.json(result);
  } catch (error) {
    if (isBulkDeleteDebugEnabled()) {
      console.error("[bulk_delete_failed]", error);
    }
    return NextResponse.json(
      {
        ok: false,
        error: "Não foi possível excluir os posts. Tente novamente.",
      },
      { status: 500 },
    );
  }
}
