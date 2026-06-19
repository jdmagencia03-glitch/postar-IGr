import { NextRequest, NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/meta/oauth";
import { claimUploadFileLease } from "@/lib/upload/queue";
import { verifyBatchFileAccess } from "@/lib/upload/batches";
import { createAdminClient } from "@/lib/supabase/admin";
import { z } from "zod";

const bodySchema = z.object({
  workerId: z.string().min(1),
});

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string; fileId: string }> },
) {
  const ownerId = await getSessionUserId();
  if (!ownerId) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const { id, fileId } = await context.params;
  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "workerId obrigatório" }, { status: 400 });
  }

  const supabase = createAdminClient();
  const access = await verifyBatchFileAccess(supabase, ownerId, id, fileId);
  if (!access) return NextResponse.json({ error: "Arquivo não encontrado" }, { status: 404 });

  if (access.file.status === "completed") {
    return NextResponse.json({ file: access.file, alreadyCompleted: true });
  }

  try {
    const file = await claimUploadFileLease(supabase, {
      batchId: id,
      fileId,
      workerId: body.workerId,
    });
    if (!file) {
      return NextResponse.json({ error: "Arquivo em uso por outro worker" }, { status: 409 });
    }
    return NextResponse.json({ file });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Falha ao reservar arquivo" },
      { status: 500 },
    );
  }
}
