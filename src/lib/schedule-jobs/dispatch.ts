import { inngest } from "@/lib/inngest/client";

export async function dispatchScheduleJob(jobId: string, ownerId: string) {
  if (process.env.INNGEST_EVENT_KEY?.trim()) {
    await inngest.send({
      name: "schedule/job.bootstrap",
      data: { jobId, ownerId },
    });
    return { mode: "inngest" as const };
  }

  return { mode: "local" as const, jobId, ownerId };
}

export async function dispatchQueueDrain(source = "manual") {
  if (process.env.INNGEST_EVENT_KEY?.trim()) {
    await inngest.send({
      name: "schedule/queue.drain",
      data: { source },
    });
    return { mode: "inngest" as const };
  }

  return { mode: "local" as const, source };
}
