import { generateBulkCaptions } from "@/lib/ai/captions";
import { logCaptionGeneration } from "@/lib/ai/caption-debug";
import { getPlaybookForAccount, resolveNicheFromPlaybook } from "@/lib/ai/playbook";
import { getPostAccountUsername } from "@/lib/posts";
import type { ScheduledPost } from "@/lib/types";

export function filenameFromPost(post: ScheduledPost, index: number) {
  const url = post.media_urls[0];
  if (!url) return `video-${index + 1}.mp4`;
  try {
    const path = new URL(url).pathname;
    const name = decodeURIComponent(path.split("/").pop() || "");
    return name || `video-${index + 1}.mp4`;
  } catch {
    return `video-${index + 1}.mp4`;
  }
}

export function postAccountId(post: ScheduledPost) {
  return post.platform === "tiktok" ? post.tiktok_account_id : post.account_id;
}

export interface RegenerateCaptionPreviewItem {
  post_id: string;
  filename: string;
  scheduled_at: string;
  old_caption: string;
  new_caption: string;
}

export async function buildRegenerateCaptionsPreview(params: {
  ownerId: string;
  accountId: string;
  accountName: string;
  posts: ScheduledPost[];
}) {
  const editable = params.posts
    .filter((post) => post.status === "pending" || post.status === "failed")
    .sort((a, b) => new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime());

  if (!editable.length) {
    return {
      preview: [] as RegenerateCaptionPreviewItem[],
      niche: "",
      debug: { accountId: params.accountId, count: 0 },
    };
  }

  const playbook = await getPlaybookForAccount(params.ownerId, params.accountId);
  const niche = resolveNicheFromPlaybook(playbook);
  const filenames = editable.map((post, index) => filenameFromPost(post, index));

  const { captions, source, debug } = await generateBulkCaptions({
    count: editable.length,
    filenames,
    ownerId: params.ownerId,
    accountId: params.accountId,
    username: params.accountName,
  });

  const preview: RegenerateCaptionPreviewItem[] = editable.map((post, index) => ({
    post_id: post.id,
    filename: filenames[index],
    scheduled_at: post.scheduled_at,
    old_caption: post.caption ?? "",
    new_caption: captions[index] ?? "",
  }));

  logCaptionGeneration("regenerate_preview", {
    accountId: params.accountId,
    accountName: params.accountName,
    niche,
    count: preview.length,
    source,
    debug,
  });

  return {
    preview,
    niche,
    source,
    accountId: params.accountId,
    accountName: params.accountName,
    playbookConfigured: Boolean(playbook),
    debug,
  };
}

export function groupPostsByAccount(posts: ScheduledPost[]) {
  const groups = new Map<string, ScheduledPost[]>();
  for (const post of posts) {
    const accountId = postAccountId(post);
    if (!accountId) continue;
    const list = groups.get(accountId) ?? [];
    list.push(post);
    groups.set(accountId, list);
  }
  return groups;
}

export function accountNameFromPost(post: ScheduledPost) {
  return getPostAccountUsername(post) ?? "perfil";
}
