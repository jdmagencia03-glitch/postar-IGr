import { isToday, parseISO } from "date-fns";
import type { Campaign, ScheduledPost } from "@/lib/types";

export interface CampaignOperationsRow {
  campaign: Campaign;
  scheduledPosts: number;
  scheduledStories: number;
  publishedToday: number;
  failedCount: number;
  pendingCount: number;
}

export function buildCampaignOperationsRows(
  campaigns: Campaign[],
  posts: ScheduledPost[],
): CampaignOperationsRow[] {
  const active = campaigns.filter((c) => c.status === "active");

  return active.map((campaign) => {
    const linked = posts.filter((post) => post.campaign_id === campaign.id);
    const activePosts = linked.filter(
      (post) => post.status === "pending" || post.status === "retrying",
    );

    return {
      campaign,
      scheduledPosts: activePosts.filter((p) => p.content_type !== "story").length,
      scheduledStories: activePosts.filter((p) => p.content_type === "story").length,
      publishedToday: linked.filter(
        (p) =>
          p.status === "published" &&
          p.published_at &&
          isToday(parseISO(p.published_at)),
      ).length,
      failedCount: linked.filter(
        (p) => p.status === "failed" || p.status === "failed_persistent",
      ).length,
      pendingCount: activePosts.length,
    };
  });
}
