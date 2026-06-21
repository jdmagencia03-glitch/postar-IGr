import { NextRequest, NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/meta/oauth";
import { buildUploadClaimConflictPayload } from "@/lib/upload/claim-conflict";
import { claimUploadFileLease, inspectUploadFileClaim } from "@/lib/upload/queue";
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
    const conflict = await inspectUploadFileClaim(supabase, {
      batchId: id,
      fileId,
      workerId: body.workerId,
    });

    if (conflict?.leasedToOther) {
      return NextResponse.json(
        buildUploadClaimConflictPayload({
          batchId: id,
          fileId,
          file: conflict.file,
        }),
        { status: 409 },
      );
    }

    const file = await claimUploadFileLease(supabase, {
      batchId: id,
      fileId,
      workerId: body.workerId,
    });
    if (!file) {
      const latest = await inspectUploadFileClaim(supabase, {
        batchId: id,
        fileId,
        workerId: body.workerId,
      });
      if (latest?.leasedToOther) {
        return NextResponse.json(
          buildUploadClaimConflictPayload({
            batchId: id,
            fileId,
            file: latest.file,
          }),
          { status: 409 },
        );
      }
      return NextResponse.json({ error: "Arquivo indisponível para claim" }, { status: 409 });
    }
    return NextResponse.json({ ok: true, file });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Falha ao reservar arquivo" },
      { status: 500 },
    );
  }
}
