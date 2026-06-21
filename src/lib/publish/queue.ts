type QueuedPost = {
  id: string;
  account_id: string | null;
  tiktok_account_id: string | null;
  platform?: string | null;
};

function accountKey(post: QueuedPost) {
  if ((post.platform ?? "instagram") === "tiktok") {
    return `tiktok:${post.tiktok_account_id ?? ""}`;
  }
  return `ig:${post.account_id ?? ""}`;
}

export { accountKey };

/** No máximo 1 post por conta por execução do cron — evita rajadas no Instagram. */
export function pickPostsForCronRun<T extends QueuedPost>(posts: T[], maxPosts: number): T[] {
  const picked: T[] = [];
  const usedAccounts = new Set<string>();

  for (const post of posts) {
    const key = accountKey(post);
    if (usedAccounts.has(key)) continue;
    usedAccounts.add(key);
    picked.push(post);
    if (picked.length >= maxPosts) break;
  }

  return picked;
}
