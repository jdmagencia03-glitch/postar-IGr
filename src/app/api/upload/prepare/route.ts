import { NextRequest, NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/meta/oauth";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  buildRandomStoragePath,
  validateUploadMetadata,
} from "@/lib/security/ownership";

export async function POST(request: NextRequest) {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  }

  const body = await request.json();
  const files = (body.files ?? []) as Array<{ name: string; type: string; size: number }>;

  if (!files.length) {
    return NextResponse.json({ error: "Nenhum arquivo informado" }, { status: 400 });
  }

  const supabase = createAdminClient();
  const uploads = [];

  for (const file of files) {
    const validation = validateUploadMetadata({
      filename: file.name,
      size: file.size,
      contentType: file.type,
    });

    if (!validation.ok) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }

    const path = buildRandomStoragePath(userId, validation.ext);
    const { data, error } = await supabase.storage.from("media").createSignedUploadUrl(path);

    if (error || !data) {
      return NextResponse.json({ error: error?.message ?? "Falha ao preparar upload" }, { status: 500 });
    }

    const { data: publicData } = supabase.storage.from("media").getPublicUrl(path);

    uploads.push({
      signedUrl: data.signedUrl,
      path: data.path,
      publicUrl: publicData.publicUrl,
      contentType: file.type || "video/mp4",
      name: file.name,
    });
  }

  return NextResponse.json({ uploads });
}
