import { inngest } from "@/lib/inngest/client";
import { createAdminClient } from "@/lib/supabase/admin";
import { drainScheduleJobQueue } from "@/lib/schedule-jobs/queue/drain";
import {
  bootstrapJobQueue,
  getJobByIdAdmin,
} from "@/lib/schedule-jobs/queue/tasks";
import { dispatchQueueDrain } from "@/lib/schedule-jobs/dispatch";

export const scheduleJobBootstrap = inngest.createFunction(
  {
    id: "schedule-job-bootstrap",
    concurrency: [{ limit: 3 }],
    retries: 3,
  },
  { event: "schedule/job.bootstrap" },
  async ({ event, step }) => {
    const { jobId } = event.data as { jobId: string; ownerId: string };

    await step.run("bootstrap-queue", async () => {
      const supabase = createAdminClient();
      const job = await getJobByIdAdmin(supabase, jobId);
      if (!job) return { skipped: true };
      await bootstrapJobQueue(supabase, job);
      return { ok: true };
    });

    await step.sendEvent("drain-after-bootstrap", {
      name: "schedule/queue.drain",
      data: { source: "bootstrap" },
    });
  },
);

export const scheduleQueueDrain = inngest.createFunction(
  {
    id: "schedule-queue-drain",
    concurrency: [{ limit: 2 }],
    retries: 2,
  },
  { event: "schedule/queue.drain" },
  async ({ event, step }) => {
    const result = await step.run("drain", async () => {
      const supabase = createAdminClient();
      return drainScheduleJobQueue(supabase, { workerPrefix: "inngest" });
    });

    if (result.claimed > 0 && result.processed < result.claimed) {
      await step.sendEvent("drain-retry", {
        name: "schedule/queue.drain",
        data: { source: "retry" },
      });
    }

    return result;
  },
);

export const scheduleQueueCron = inngest.createFunction(
  {
    id: "schedule-queue-cron",
  },
  { cron: "*/1 * * * *" },
  async ({ step }) => {
    await step.run("cron-drain", async () => {
      await dispatchQueueDrain("inngest-cron");
      const supabase = createAdminClient();
      return drainScheduleJobQueue(supabase, { workerPrefix: "inngest-cron" });
    });
  },
);

export const scheduleInngestFunctions = [
  scheduleJobBootstrap,
  scheduleQueueDrain,
  scheduleQueueCron,
];
