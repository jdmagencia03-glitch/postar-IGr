import type { InstagramAccount } from "@/lib/types";

type AuthProvider = "instagram" | "facebook";

function graphBase(provider: AuthProvider) {
  return provider === "facebook" ? "https://graph.facebook.com/v21.0" : "https://graph.instagram.com/v21.0";
}

export type PrivateReplyResult = {
  ok: boolean;
  messageId?: string;
  raw: unknown;
  error?: string;
};

/** Envia DM via Private Reply (recipient = comment_id) — API oficial Meta. */
export async function sendPrivateReplyToComment(params: {
  account: Pick<InstagramAccount, "page_id" | "auth_provider">;
  token: string;
  commentId: string;
  message: string;
}): Promise<PrivateReplyResult> {
  const provider = params.account.auth_provider === "facebook" ? "facebook" : "instagram";
  const graph = graphBase(provider);
  const pageId = params.account.page_id;

  if (!pageId) {
    return { ok: false, raw: null, error: "Conta sem page_id — reconecte via Facebook + Página." };
  }

  const body = {
    recipient: { comment_id: params.commentId },
    message: { text: params.message },
  };

  const res = await fetch(`${graph}/${pageId}/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${params.token}`,
    },
    body: JSON.stringify(body),
  });

  const data = await res.json();

  if (!res.ok) {
    const errMsg =
      (data as { error?: { message?: string; error_user_msg?: string } }).error?.message ??
      (data as { error?: { error_user_msg?: string } }).error?.error_user_msg ??
      "Falha ao enviar DM";
    return { ok: false, raw: data, error: errMsg };
  }

  const messageId = (data as { message_id?: string }).message_id;
  return { ok: true, messageId, raw: data };
}

export type IgComment = {
  id: string;
  text?: string;
  username?: string;
  timestamp?: string;
  from?: { id?: string; username?: string };
};

export async function fetchMediaComments(params: {
  mediaId: string;
  token: string;
  provider?: AuthProvider;
  limit?: number;
}) {
  const graph = graphBase(params.provider ?? "facebook");
  const fields = "id,text,username,timestamp,from{id,username}";
  const url = `${graph}/${params.mediaId}/comments?fields=${fields}&limit=${params.limit ?? 50}&access_token=${encodeURIComponent(params.token)}`;

  const res = await fetch(url, { cache: "no-store" });
  const data = await res.json();

  if (!res.ok) {
    throw new Error(
      (data as { error?: { message?: string } }).error?.message ?? "Falha ao buscar comentários",
    );
  }

  return ((data as { data?: IgComment[] }).data ?? []) as IgComment[];
}

export async function fetchRecentMediaIds(params: {
  igUserId: string;
  token: string;
  provider?: AuthProvider;
  limit?: number;
}) {
  const graph = graphBase(params.provider ?? "facebook");
  const url = `${graph}/${params.igUserId}/media?fields=id,timestamp&limit=${params.limit ?? 15}&access_token=${encodeURIComponent(params.token)}`;

  const res = await fetch(url, { cache: "no-store" });
  const data = await res.json();

  if (!res.ok) {
    throw new Error(
      (data as { error?: { message?: string } }).error?.message ?? "Falha ao buscar mídias",
    );
  }

  return ((data as { data?: Array<{ id: string }> }).data ?? []).map((item) => item.id);
}

export function mapMetaApiError(message: string) {
  const lower = message.toLowerCase();
  if (lower.includes("outside of allowed window")) {
    return "Fora da janela permitida pela Meta (Private Reply: até 7 dias após o comentário).";
  }
  if (lower.includes("permission") || lower.includes("oauth")) {
    return "Permissão insuficiente — reconecte a conta com permissões de comentários e mensagens.";
  }
  return message;
}
