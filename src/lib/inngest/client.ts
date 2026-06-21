import { Inngest } from "inngest";

export const inngest = new Inngest({
  id: "postarigr",
  name: "Postarigr",
});

export const scheduleJobFunctions = [
  "schedule/job.bootstrap",
  "schedule/queue.drain",
  "schedule/task.run",
] as const;
