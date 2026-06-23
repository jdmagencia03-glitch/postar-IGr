import assert from "node:assert/strict";
import {
  captionNeedsProcessing,
  countItemPipeline,
  deriveCaptionStatus,
} from "../src/lib/schedule-jobs/item-pipeline";
import type { ScheduleJobItemRow } from "../src/lib/schedule-jobs/types";

function item(partial: Partial<ScheduleJobItemRow>): ScheduleJobItemRow {
  return {
    id: partial.id ?? "id",
    schedule_job_id: "job",
    upload_file_id: null,
    sort_order: partial.sort_order ?? 0,
    filename: partial.filename ?? "v.mp4",
    media_urls: partial.media_urls ?? ["https://example.com/v.mp4"],
    status: partial.status ?? "queued",
    scheduled_at: null,
    destinations: partial.destinations ?? null,
    caption: partial.caption ?? null,
    hashtags: partial.hashtags ?? null,
    created_post_id: partial.created_post_id ?? null,
    parent_publish_group_id: null,
    error_message: partial.error_message ?? null,
    attempt_count: partial.attempt_count ?? 0,
    pipeline: partial.pipeline,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

const pending = item({ id: "1" });
assert.equal(deriveCaptionStatus(pending), "caption_pending");
assert.equal(captionNeedsProcessing(pending), true);

const done = item({ id: "2", caption: "Legenda #viral", sort_order: 1 });
assert.equal(deriveCaptionStatus(done), "caption_done");
assert.equal(captionNeedsProcessing(done), false);

const calendar = item({
  id: "3",
  caption: "Legenda",
  destinations: [
    {
      platform: "instagram",
      account_id: "acc",
      caption: "Legenda",
      scheduled_at: new Date().toISOString(),
    },
  ],
  sort_order: 2,
});
assert.equal(captionNeedsProcessing(calendar), false);

const counts = countItemPipeline([pending, done, calendar]);
assert.equal(counts.total, 3);
assert.equal(counts.captionDone, 2);
assert.equal(counts.captionPending, 1);
assert.equal(counts.calendarDone, 1);

console.log("schedule-job-pipeline: ok");
