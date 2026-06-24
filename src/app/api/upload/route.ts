import { NextRequest, NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/meta/oauth";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  buildRandomStoragePath,
  validateUploadMetadata,
} from "@/lib/security/ownership";
import {
  buildBunnyCdnUrl,
  buildBunnyStorageApiUrl,
  getBunnyStorageConfig,
  getMediaStorageProvider,
} from "@/lib/storage/bunny";
import { STORAGE_CACHE_CONTROL } from "@/lib/upload/storage-config";

export async function POST(request: NextRequest) {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  }

  const formData = await request.formData();
  const files = formData.getAll("files") as File[];

  if (!files.length) {
    return NextResponse.json({ error: "Nenhum arquivo enviado" }, { status: 400 });
  }

  const provider = getMediaStorageProvider();
  const bunny = getBunnyStorageConfig();
  const supabase = createAdminClient();
  const urls: string[] = [];

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
    const contentType = file.type || "video/mp4";

    if (provider === "bunny" && bunny) {
      const uploadUrl = buildBunnyStorageApiUrl(path, bunny);
      const publicUrl = buildBunnyCdnUrl(path, bunny);
      if (!uploadUrl || !publicUrl) {
        return NextResponse.json({ error: "Bunny Storage não configurado" }, { status: 500 });
      }

      const res = await fetch(uploadUrl, {
        method: "PUT",
        headers: {
          AccessKey: bunny.accessKey,
          "Content-Type": contentType,
          "Cache-Control": STORAGE_CACHE_CONTROL,
        },
        body: file,
      });

      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        return NextResponse.json(
          { error: `Falha ao enviar para Bunny (${res.status}): ${detail || res.statusText}` },
          { status: 500 },
        );
      }

      urls.push(publicUrl);
      continue;
    }

    const { error } = await supabase.storage.from("media").upload(path, file, {
      contentType,
      upsert: false,
    });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const { data } = supabase.storage.from("media").getPublicUrl(path);
    urls.push(data.publicUrl);
  }

  return NextResponse.json({ urls });
}
