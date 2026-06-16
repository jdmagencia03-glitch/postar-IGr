import type { createAdminClient } from "@/lib/supabase/admin";

type AdminClient = ReturnType<typeof createAdminClient>;

export class PublishGuardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PublishGuardError";
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function logPublishEvent(
  supabase: AdminClient,
  postId: string,
  level: "info" | "error" | "success",
  message: string,
) {
  const { error } = await supabase.from("publish_logs").insert({ post_id: postId, level, message });
  if (error) {
    console.error(`[publish] log failed for ${postId}:`, error.message);
  }
}

async function countSuccessLogs(supabase: AdminClient, postId: string) {
  const { count, error } = await supabase
    .from("publish_logs")
    .select("id", { count: "exact", head: true })
    .eq("post_id", postId)
    .eq("level", "success");

  if (error) {
    throw new Error(`Falha ao verificar logs de publicação: ${error.message}`);
  }

  return count ?? 0;
}

/** Bloqueia republicação se o post já foi publicado no passado (log de sucesso ou media_id). */
export async function assertSafeToPublish(supabase: AdminClient, postId: string) {
  const { data: post, error } = await supabase
    .from("scheduled_posts")
    .select("status, media_id")
    .eq("id", postId)
    .maybeSingle();

  if (error) {
    throw new Error(`Falha ao verificar post: ${error.message}`);
  }

  if (!post) {
    throw new PublishGuardError("Post não encontrado");
  }

  if (post.media_id) {
    throw new PublishGuardError("Post já possui media_id — republicação bloqueada");
  }

  if (post.status === "published") {
    throw new PublishGuardError("Post já publicado — republicação bloqueada");
  }

  const successLogs = await countSuccessLogs(supabase, postId);
  if (successLogs > 0) {
    await supabase
      .from("scheduled_posts")
      .update({
        status: "failed",
        error_message:
          "Publicação anterior detectada nos logs. Republicação bloqueada por segurança. Verifique o Instagram.",
      })
      .eq("id", postId)
      .in("status", ["pending", "processing"])
      .is("media_id", null);

    throw new PublishGuardError("Log de sucesso existente — republicação bloqueada");
  }
}

export async function recoverStaleProcessingPosts(supabase: AdminClient, staleMs: number) {
  const staleBefore = new Date(Date.now() - staleMs).toISOString();

  const { data: processingPosts, error } = await supabase
    .from("scheduled_posts")
    .select("id, media_id")
    .eq("status", "processing");

  if (error) {
    console.error("[publish] stale recovery query failed:", error.message);
    return 0;
  }

  let recovered = 0;

  for (const post of processingPosts ?? []) {
    if (post.media_id) {
      await supabase
        .from("scheduled_posts")
        .update({ status: "published", error_message: null })
        .eq("id", post.id)
        .eq("status", "processing");
      recovered += 1;
      continue;
    }

    const successLogs = await countSuccessLogs(supabase, post.id);
    if (successLogs > 0) {
      await supabase
        .from("scheduled_posts")
        .update({
          status: "failed",
          error_message:
            "Publicação detectada nos logs, mas registro incompleto. Republicação bloqueada.",
        })
        .eq("id", post.id)
        .eq("status", "processing");
      recovered += 1;
      continue;
    }

    const { data: lastStart } = await supabase
      .from("publish_logs")
      .select("created_at")
      .eq("post_id", post.id)
      .eq("level", "info")
      .ilike("message", "Iniciando publicação%")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const startedAt = lastStart?.created_at;
    if (startedAt && startedAt >= staleBefore) {
      continue;
    }

    const { error: updateError } = await supabase
      .from("scheduled_posts")
      .update({
        status: "failed",
        error_message: "Publicação interrompida. Tente novamente.",
      })
      .eq("id", post.id)
      .eq("status", "processing")
      .is("media_id", null);

    if (updateError) {
      console.error(`[publish] stale recovery failed for ${post.id}:`, updateError.message);
      continue;
    }

    recovered += 1;
    await logPublishEvent(
      supabase,
      post.id,
      "error",
      "Publicação interrompida (timeout). Status revertido para falha.",
    );
  }

  return recovered;
}

/** Reserva o post de forma atômica — retorna false se outro cron já pegou. */
export async function claimPostForProcessing(
  supabase: AdminClient,
  postId: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from("scheduled_posts")
    .update({ status: "processing" })
    .eq("id", postId)
    .eq("status", "pending")
    .is("media_id", null)
    .select("id")
    .maybeSingle();

  if (error) {
    throw new Error(`Falha ao reservar post: ${error.message}`);
  }

  return Boolean(data);
}

/** Grava media_id IMEDIATAMENTE após sucesso na API — impede loop de republicação. */
export async function persistPublishedMediaId(
  supabase: AdminClient,
  postId: string,
  fields: {
    container_id?: string | null;
    media_id: string;
    permalink?: string | null;
  },
) {
  const now = new Date().toISOString();
  const payload = {
    status: "published" as const,
    container_id: fields.container_id ?? null,
    media_id: fields.media_id,
    permalink: fields.permalink ?? null,
    published_at: now,
    error_message: null,
  };

  const { data, error } = await supabase
    .from("scheduled_posts")
    .update(payload)
    .eq("id", postId)
    .is("media_id", null)
    .select("id")
    .maybeSingle();

  if (error) {
    throw new Error(`Falha crítica ao gravar media_id: ${error.message}`);
  }

  if (data) {
    return;
  }

  const { data: existing, error: readError } = await supabase
    .from("scheduled_posts")
    .select("media_id, status")
    .eq("id", postId)
    .maybeSingle();

  if (readError) {
    throw new Error(`Falha ao confirmar media_id: ${readError.message}`);
  }

  if (existing?.media_id) {
    return;
  }

  throw new Error("Falha crítica: publicação no Instagram sem persistência de media_id");
}

export async function persistPublishedMediaIdWithRetry(
  supabase: AdminClient,
  postId: string,
  fields: {
    container_id?: string | null;
    media_id: string;
    permalink?: string | null;
  },
  attempts = 5,
) {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      await persistPublishedMediaId(supabase, postId, fields);
      return;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error("Erro desconhecido");
      await sleep(400 * (attempt + 1));
    }
  }

  throw lastError ?? new Error("Falha crítica ao persistir media_id");
}

export async function markPostPublished(
  supabase: AdminClient,
  postId: string,
  fields: {
    container_id?: string | null;
    media_id: string;
    permalink?: string | null;
  },
) {
  await persistPublishedMediaIdWithRetry(supabase, postId, fields);
}

/** Mantém em processing se IG publicou mas banco falhou — NUNCA volta para pending. */
export async function markPostPublishCriticalFailure(
  supabase: AdminClient,
  postId: string,
  mediaId: string,
  message: string,
) {
  await supabase
    .from("scheduled_posts")
    .update({
      status: "processing",
      media_id: mediaId,
      error_message: message,
    })
    .eq("id", postId)
    .is("media_id", null);

  await logPublishEvent(
    supabase,
    postId,
    "error",
    `CRÍTICO: ${message} (media_id=${mediaId}). Republicação bloqueada.`,
  );
}

export async function markPostFailed(supabase: AdminClient, postId: string, message: string) {
  const { data: post } = await supabase
    .from("scheduled_posts")
    .select("media_id")
    .eq("id", postId)
    .maybeSingle();

  if (post?.media_id) {
    await logPublishEvent(
      supabase,
      postId,
      "error",
      "Ignorado markPostFailed: post já tem media_id (republicação bloqueada).",
    );
    return;
  }

  const successLogs = await countSuccessLogs(supabase, postId);
  if (successLogs > 0) {
    await supabase
      .from("scheduled_posts")
      .update({
        status: "failed",
        error_message:
          "Publicação detectada nos logs. Republicação bloqueada por segurança.",
      })
      .eq("id", postId)
      .is("media_id", null);
    return;
  }

  const { error } = await supabase
    .from("scheduled_posts")
    .update({
      status: "failed",
      error_message: message,
    })
    .eq("id", postId)
    .is("media_id", null);

  if (error) {
    console.error(`[publish] failed to mark post ${postId} as failed:`, error.message);
  }
}
