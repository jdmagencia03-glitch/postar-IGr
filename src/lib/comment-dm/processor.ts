import type { SupabaseClient } from "@supabase/supabase-js";
import {
  matchCommentKeyword,
  mediaMatchesScope,
  renderDmMessage,
} from "@/lib/comment-dm/match";
import {
  incrementAutomationStats,
  listEnabledAutomationsWithAccounts,
  touchAutomationPolledAt,
} from "@/lib/comment-dm/repository";
import type { CommentDmAutomation, IncomingCommentPayload } from "@/lib/comment-dm/types";
import {
  fetchMediaComments,
  fetchRecentMediaIds,
  mapMetaApiError,
  sendPrivateReplyToComment,
} from "@/lib/meta/comment-dm-api";
import { getAccountAccessToken } from "@/lib/accounts";
import type { InstagramAccount } from "@/lib/types";

const MAX_DMS_PER_CRON_RUN = 30;
const MAX_MEDIA_PER_POLL = 10;
const COMMENTS_PER_MEDIA = 30;

type AutomationRow = CommentDmAutomation & {
  instagram_accounts: InstagramAccount | null;
};

async function findMatchingAutomation(
  automations: AutomationRow[],
  payload: IncomingCommentPayload & { accountId?: string },
) {
  for (const automation of automations) {
    if (payload.accountId && automation.account_id !== payload.accountId) continue;
    if (!mediaMatchesScope(automation.apply_to, automation.target_media_ids, payload.mediaId)) {
      continue;
    }
    const keyword = matchCommentKeyword(payload.text, automation.keywords);
    if (keyword) return { automation, keyword };
  }
  return null;
}

async function dispatchPrivateReply(
  supabase: SupabaseClient,
  automation: AutomationRow,
  account: InstagramAccount,
  params: {
    commentId: string;
    mediaId?: string;
    text: string;
    keyword: string;
    commenterIgId?: string;
    commenterUsername?: string;
    commentCreatedAt?: string;
    source: IncomingCommentPayload["source"];
  },
) {
  const rendered = renderDmMessage(automation.dm_message_template, {
    keyword: params.keyword,
    username: params.commenterUsername,
    link: automation.dm_link,
  });

  const { data: inserted, error: insertError } = await supabase
    .from("comment_dm_events")
    .insert({
      automation_id: automation.id,
      account_id: automation.account_id,
      owner_id: automation.owner_id,
      comment_id: params.commentId,
      media_id: params.mediaId ?? null,
      commenter_ig_id: params.commenterIgId ?? null,
      commenter_username: params.commenterUsername ?? null,
      comment_text: params.text,
      matched_keyword: params.keyword,
      rendered_message: rendered,
      status: "pending",
      source: params.source,
      comment_created_at: params.commentCreatedAt ?? null,
    })
    .select("*")
    .maybeSingle();

  if (insertError) {
    if (insertError.code === "23505") {
      return { skipped: true as const, reason: "duplicate" };
    }
    throw new Error(insertError.message);
  }

  if (!inserted) {
    return { skipped: true as const, reason: "duplicate" };
  }

  await incrementAutomationStats(supabase, automation.id, { detected: 1 });

  const token = getAccountAccessToken(account);
  if (!token) {
    const errorMessage = "Token da conta indisponível — reconecte a conta.";
    await supabase
      .from("comment_dm_events")
      .update({
        status: "failed",
        error_message: errorMessage,
        processed_at: new Date().toISOString(),
      })
      .eq("id", inserted.id);
    await incrementAutomationStats(supabase, automation.id, { failures: 1 });
    return { skipped: false as const, status: "failed" as const, error: errorMessage };
  }

  const result = await sendPrivateReplyToComment({
    account,
    token,
    commentId: params.commentId,
    message: rendered,
  });

  if (result.ok) {
    await supabase
      .from("comment_dm_events")
      .update({
        status: "sent",
        api_response: result.raw as Record<string, unknown>,
        processed_at: new Date().toISOString(),
      })
      .eq("id", inserted.id);
    await incrementAutomationStats(supabase, automation.id, { sent: 1 });
    return { skipped: false as const, status: "sent" as const };
  }

  const errorMessage = mapMetaApiError(result.error ?? "Falha ao enviar DM");
  await supabase
    .from("comment_dm_events")
    .update({
      status: "failed",
      error_message: errorMessage,
      api_response: result.raw as Record<string, unknown>,
      processed_at: new Date().toISOString(),
    })
    .eq("id", inserted.id);
  await incrementAutomationStats(supabase, automation.id, { failures: 1 });
  return { skipped: false as const, status: "failed" as const, error: errorMessage };
}

export async function processIncomingComment(
  supabase: SupabaseClient,
  automations: AutomationRow[],
  payload: IncomingCommentPayload & { accountId: string },
) {
  const match = await findMatchingAutomation(automations, payload);
  if (!match) return { matched: false as const };

  const account = automations.find((a) => a.id === match.automation.id)?.instagram_accounts;
  if (!account) {
    return { matched: true as const, status: "failed" as const, error: "Conta não encontrada" };
  }

  const result = await dispatchPrivateReply(supabase, match.automation, account, {
    commentId: payload.commentId,
    mediaId: payload.mediaId,
    text: payload.text,
    keyword: match.keyword,
    commenterIgId: payload.commenterIgId,
    commenterUsername: payload.commenterUsername,
    commentCreatedAt: payload.commentCreatedAt,
    source: payload.source,
  });

  return { matched: true as const, ...result };
}

export async function processPendingEvents(supabase: SupabaseClient, limit = MAX_DMS_PER_CRON_RUN) {
  const { data: pending } = await supabase
    .from("comment_dm_events")
    .select("*, comment_dm_automations(*), instagram_accounts(*)")
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .limit(limit);

  const results: Array<{ eventId: string; status: string; error?: string }> = [];

  for (const event of pending ?? []) {
    const automation = event.comment_dm_automations as AutomationRow | null;
    const account = event.instagram_accounts as InstagramAccount | null;

    if (!automation?.enabled || !account) {
      await supabase
        .from("comment_dm_events")
        .update({
          status: "skipped",
          error_message: "Automação desativada ou conta removida",
          processed_at: new Date().toISOString(),
        })
        .eq("id", event.id);
      results.push({ eventId: event.id, status: "skipped" });
      continue;
    }

    const token = getAccountAccessToken(account);
    if (!token) {
      await supabase
        .from("comment_dm_events")
        .update({
          status: "failed",
          error_message: "Token indisponível",
          processed_at: new Date().toISOString(),
        })
        .eq("id", event.id);
      await incrementAutomationStats(supabase, automation.id, { failures: 1 });
      results.push({ eventId: event.id, status: "failed", error: "Token indisponível" });
      continue;
    }

    const message =
      event.rendered_message ??
      renderDmMessage(automation.dm_message_template, {
        keyword: event.matched_keyword ?? "",
        username: event.commenter_username ?? undefined,
        link: automation.dm_link,
      });

    const result = await sendPrivateReplyToComment({
      account,
      token,
      commentId: event.comment_id,
      message,
    });

    if (result.ok) {
      await supabase
        .from("comment_dm_events")
        .update({
          status: "sent",
          rendered_message: message,
          api_response: result.raw as Record<string, unknown>,
          processed_at: new Date().toISOString(),
        })
        .eq("id", event.id);
      await incrementAutomationStats(supabase, automation.id, { sent: 1 });
      results.push({ eventId: event.id, status: "sent" });
    } else {
      const errorMessage = mapMetaApiError(result.error ?? "Falha ao enviar DM");
      await supabase
        .from("comment_dm_events")
        .update({
          status: "failed",
          error_message: errorMessage,
          api_response: result.raw as Record<string, unknown>,
          processed_at: new Date().toISOString(),
        })
        .eq("id", event.id);
      await incrementAutomationStats(supabase, automation.id, { failures: 1 });
      results.push({ eventId: event.id, status: "failed", error: errorMessage });
    }
  }

  return results;
}

export async function pollAutomationsForComments(supabase: SupabaseClient) {
  const automations = (await listEnabledAutomationsWithAccounts(supabase)) as AutomationRow[];
  const results: Array<{ automationId: string; processed: number; errors: string[] }> = [];

  for (const automation of automations) {
    const account = automation.instagram_accounts;
    if (!account) continue;

    const token = getAccountAccessToken(account);
    if (!token) continue;

    const provider = account.auth_provider === "facebook" ? "facebook" : "instagram";
    const mediaIds =
      automation.apply_to === "specific" && automation.target_media_ids.length
        ? automation.target_media_ids
        : await fetchRecentMediaIds({
            igUserId: account.ig_user_id,
            token,
            provider,
            limit: MAX_MEDIA_PER_POLL,
          });

    let processed = 0;
    const errors: string[] = [];

    for (const mediaId of mediaIds) {
      try {
        const comments = await fetchMediaComments({
          mediaId,
          token,
          provider,
          limit: COMMENTS_PER_MEDIA,
        });

        for (const comment of comments) {
          if (!comment.text || !comment.id) continue;

          const since = automation.last_polled_at ? new Date(automation.last_polled_at).getTime() : 0;
          if (comment.timestamp && since && new Date(comment.timestamp).getTime() < since) {
            continue;
          }

          const outcome = await processIncomingComment(supabase, [automation], {
            accountId: automation.account_id,
            commentId: comment.id,
            mediaId,
            text: comment.text,
            commenterIgId: comment.from?.id,
            commenterUsername: comment.username ?? comment.from?.username,
            commentCreatedAt: comment.timestamp,
            igUserId: account.ig_user_id,
            source: "poll",
          });

          if (outcome.matched && !("skipped" in outcome && outcome.skipped)) {
            processed += 1;
          }
        }
      } catch (err) {
        errors.push(err instanceof Error ? err.message : "Erro ao buscar comentários");
      }
    }

    await touchAutomationPolledAt(supabase, automation.id);
    results.push({ automationId: automation.id, processed, errors });
  }

  return results;
}

export async function handleWebhookComment(
  supabase: SupabaseClient,
  igUserId: string,
  comment: {
    id: string;
    text?: string;
    media?: { id?: string };
    from?: { id?: string; username?: string };
    timestamp?: string;
  },
) {
  const { data: account } = await supabase
    .from("instagram_accounts")
    .select("*")
    .eq("ig_user_id", igUserId)
    .limit(1)
    .maybeSingle();

  if (!account) return { ok: false, error: "Conta não encontrada" };

  const automations = (await listEnabledAutomationsWithAccounts(supabase)).filter(
    (a) => a.account_id === account.id,
  ) as AutomationRow[];

  if (!automations.length || !comment.text) {
    return { ok: true, matched: false };
  }

  const outcome = await processIncomingComment(supabase, automations, {
    accountId: account.id,
    commentId: comment.id,
    mediaId: comment.media?.id,
    text: comment.text,
    commenterIgId: comment.from?.id,
    commenterUsername: comment.from?.username,
    commentCreatedAt: comment.timestamp,
    igUserId,
    source: "webhook",
  });

  return { ok: true, ...outcome };
}
