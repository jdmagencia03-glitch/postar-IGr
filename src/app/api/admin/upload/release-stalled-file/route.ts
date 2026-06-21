import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requirePlatformAdmin } from "@/lib/admin/gate";
import { formatZodError } from "@/lib/api-errors";
import { getSessionUserId } from "@/lib/meta/oauth";
import { createAdminClient } from "@/lib/supabase/admin";
import { releaseStalledUploadFile } from "@/lib/upload/admin-diagnostics";

const bodySchema = z.object({
  batchId: z.string().uuid(),
  fileId: z.string().uuid(),
  confirm: z.boolean().default(false),
});

/** Libera claim stale de arquivo de upload (admin). */
export async function POST(request: NextRequest) {
  const sessionOwnerId = await getSessionUserId();
  if (!sessionOwnerId) {
    return NextResponse.json({ ok: false, error: "unauthenticated" }, { status: 401 });
  }

  const supabase = createAdminClient();
  const gate = await requirePlatformAdmin(supabase, sessionOwnerId);
  if (!gate.ok) {
    return NextResponse.json({ ok: false, error: "forbidden", message: gate.error }, { status: 403 });
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: formatZodError(parsed.error) }, { status: 400 });
  }

  const result = await releaseStalledUploadFile(supabase, sessionOwnerId, parsed.data);

  if (!result.ok) {
    const status = result.error === "cannot_release" ? 409 : 404;
    return NextResponse.json(result, { status });
  }

  return NextResponse.json(result);
}
