import { MAX_UPLOAD_BYTES } from "@/lib/upload/storage-config";

const MIN_CHUNK_BYTES = 5 * 1024 * 1024;
const MAX_SINGLE_UPLOAD_BYTES = 64 * 1024 * 1024;
const PREFERRED_MULTI_CHUNK_BYTES = 64 * 1024 * 1024;

export type VideoDownloadResult = {
  buffer: Buffer;
  size: number;
  contentType: string;
};

export type TikTokChunk = {
  index: number;
  start: number;
  end: number;
  size: number;
  contentRange: string;
};

export type TikTokChunkPlan = {
  videoSize: number;
  chunkSize: number;
  totalChunkCount: number;
  chunks: TikTokChunk[];
};

export type TikTokChunkPlanLog = {
  method: "FILE_UPLOAD";
  videoSize: number;
  chunkSize: number;
  totalChunkCount: number;
  firstContentRange: string;
  lastContentRange: string;
  chunksPreview: Array<{
    index: number;
    contentRange: string;
    size: number;
  }>;
};

function buildChunks(videoSize: number, chunkSize: number, totalChunkCount: number): TikTokChunk[] {
  const chunks: TikTokChunk[] = [];

  for (let index = 0; index < totalChunkCount; index++) {
    const start = index * chunkSize;
    const end = index === totalChunkCount - 1 ? videoSize - 1 : start + chunkSize - 1;
    const size = end - start + 1;

    chunks.push({
      index,
      start,
      end,
      size,
      contentRange: `bytes ${start}-${end}/${videoSize}`,
    });
  }

  return chunks;
}

function assertValidChunkPlan(plan: TikTokChunkPlan) {
  const { videoSize, totalChunkCount, chunks } = plan;

  if (chunks.length !== totalChunkCount) {
    throw new Error(
      `Plano de chunks inválido: chunks.length (${chunks.length}) !== totalChunkCount (${totalChunkCount})`,
    );
  }

  if (chunks.length === 0) {
    throw new Error("Plano de chunks inválido: nenhum chunk");
  }

  if (chunks[0].start !== 0) {
    throw new Error(`Plano de chunks inválido: primeiro chunk não começa em 0 (start=${chunks[0].start})`);
  }

  const last = chunks[chunks.length - 1];
  if (last.end !== videoSize - 1) {
    throw new Error(
      `Plano de chunks inválido: último chunk não termina em videoSize-1 (end=${last.end}, expected=${videoSize - 1})`,
    );
  }

  const totalBytes = chunks.reduce((sum, chunk) => sum + chunk.size, 0);
  if (totalBytes !== videoSize) {
    throw new Error(
      `Plano de chunks inválido: soma dos chunks (${totalBytes}) !== videoSize (${videoSize})`,
    );
  }

  for (let i = 1; i < chunks.length; i++) {
    if (chunks[i].start !== chunks[i - 1].end + 1) {
      throw new Error(
        `Plano de chunks inválido: buraco ou sobreposição entre chunk ${i - 1} e ${i}`,
      );
    }
  }
}

/**
 * TikTok: total_chunk_count = floor(video_size / chunk_size); sobra vai no último chunk.
 * @see https://developers.tiktok.com/doc/content-posting-api-media-transfer-guide
 */
export function computeTikTokChunks(videoSize: number): TikTokChunkPlan {
  if (videoSize <= 0) {
    throw new Error("Vídeo vazio — não é possível enviar ao TikTok");
  }

  let chunkSize: number;
  let totalChunkCount: number;

  if (videoSize < MIN_CHUNK_BYTES || videoSize <= MAX_SINGLE_UPLOAD_BYTES) {
    chunkSize = videoSize;
    totalChunkCount = 1;
  } else {
    chunkSize = PREFERRED_MULTI_CHUNK_BYTES;
    totalChunkCount = Math.floor(videoSize / chunkSize);

    // Entre 64MB e ~128MB floor(64MB) = 1 — usar metade do vídeo para garantir >= 2 chunks.
    if (totalChunkCount < 2) {
      chunkSize = Math.max(MIN_CHUNK_BYTES, Math.floor(videoSize / 2));
      totalChunkCount = Math.floor(videoSize / chunkSize);
    }

    if (totalChunkCount < 2) {
      throw new Error(
        `Não foi possível calcular chunks TikTok para vídeo de ${videoSize} bytes (> 64 MB)`,
      );
    }
  }

  const plan: TikTokChunkPlan = {
    videoSize,
    chunkSize,
    totalChunkCount,
    chunks: buildChunks(videoSize, chunkSize, totalChunkCount),
  };

  assertValidChunkPlan(plan);
  return plan;
}

export function computeTikTokChunkPlan(videoSize: number) {
  const plan = computeTikTokChunks(videoSize);
  return {
    chunkSize: plan.chunkSize,
    totalChunkCount: plan.totalChunkCount,
  };
}

export function formatTikTokChunkPlanLog(plan: TikTokChunkPlan): TikTokChunkPlanLog {
  return {
    method: "FILE_UPLOAD",
    videoSize: plan.videoSize,
    chunkSize: plan.chunkSize,
    totalChunkCount: plan.totalChunkCount,
    firstContentRange: plan.chunks[0]?.contentRange ?? "",
    lastContentRange: plan.chunks[plan.chunks.length - 1]?.contentRange ?? "",
    chunksPreview: plan.chunks.map((chunk) => ({
      index: chunk.index,
      contentRange: chunk.contentRange,
      size: chunk.size,
    })),
  };
}

export async function probeVideoForTikTokUpload(videoUrl: string): Promise<{
  videoUrl: string;
  videoSize: number;
  mimeType: string;
}> {
  const head = await fetch(videoUrl, { method: "HEAD" }).catch(() => null);
  const declaredSize = head?.ok ? Number(head.headers.get("content-length") ?? 0) : 0;
  const headMime = head?.headers.get("content-type")?.split(";")[0]?.trim();

  if (declaredSize > 0) {
    if (declaredSize > MAX_UPLOAD_BYTES) {
      throw new Error(
        `Vídeo excede o limite do app (${Math.round(MAX_UPLOAD_BYTES / (1024 * 1024))} MB) para upload TikTok`,
      );
    }

    return {
      videoUrl,
      videoSize: declaredSize,
      mimeType: headMime || "video/mp4",
    };
  }

  const downloaded = await downloadVideoForTikTok(videoUrl);
  return {
    videoUrl,
    videoSize: downloaded.size,
    mimeType: downloaded.contentType,
  };
}

export async function downloadVideoForTikTok(videoUrl: string): Promise<VideoDownloadResult> {
  const head = await fetch(videoUrl, { method: "HEAD" }).catch(() => null);
  const declaredSize = head?.ok ? Number(head.headers.get("content-length") ?? 0) : 0;

  if (declaredSize > MAX_UPLOAD_BYTES) {
    throw new Error(
      `Vídeo excede o limite do app (${Math.round(MAX_UPLOAD_BYTES / (1024 * 1024))} MB) para upload TikTok`,
    );
  }

  const res = await fetch(videoUrl);
  if (!res.ok) {
    throw new Error(
      `Falha ao baixar vídeo do storage (${res.status}). Confirme URL pública do Supabase.`,
    );
  }

  const arrayBuffer = await res.arrayBuffer();
  const size = arrayBuffer.byteLength;

  if (size > MAX_UPLOAD_BYTES) {
    throw new Error(
      `Vídeo excede o limite do app (${Math.round(MAX_UPLOAD_BYTES / (1024 * 1024))} MB) para upload TikTok`,
    );
  }

  const contentType = res.headers.get("content-type")?.split(";")[0]?.trim() || "video/mp4";

  return {
    buffer: Buffer.from(arrayBuffer),
    size,
    contentType,
  };
}

export async function uploadVideoChunksToTikTok(params: {
  uploadUrl: string;
  buffer: Buffer;
  chunks: TikTokChunk[];
  contentType?: string;
}) {
  const { uploadUrl, buffer, chunks } = params;
  const contentType = params.contentType ?? "video/mp4";

  for (const chunk of chunks) {
    const body = buffer.subarray(chunk.start, chunk.end + 1);

    if (body.length !== chunk.size) {
      throw new Error(
        `Chunk ${chunk.index + 1}: tamanho real (${body.length}) !== esperado (${chunk.size})`,
      );
    }

    const res = await fetch(uploadUrl, {
      method: "PUT",
      headers: {
        "Content-Type": contentType,
        "Content-Length": String(chunk.size),
        "Content-Range": chunk.contentRange,
      },
      body: new Uint8Array(body),
    });

    if (!res.ok) {
      const responseBody = await res.text().catch(() => "");
      throw new Error(
        `Falha no upload chunk ${chunk.index + 1}/${chunks.length} para TikTok (${res.status})${responseBody ? `: ${responseBody.slice(0, 200)}` : ""}`,
      );
    }
  }
}
