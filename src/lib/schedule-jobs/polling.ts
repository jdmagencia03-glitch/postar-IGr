/** Lotes pequenos usam polling mais agressivo no início. */
export const SCHEDULE_JOB_SMALL_BATCH_THRESHOLD = 15;

/** Delays em ms entre polls (após o poll imediato inicial). */
const SMALL_BATCH_POLL_DELAYS_MS = [1000, 1000, 1000, 2000, 3000, 3000] as const;
const DEFAULT_POLL_DELAYS_MS = [2000, 3000, 5000] as const;

export function isSmallScheduleJob(videoCount: number) {
  return videoCount > 0 && videoCount <= SCHEDULE_JOB_SMALL_BATCH_THRESHOLD;
}

/** Delay antes do próximo poll (pollIndex 0 = imediato, sem delay prévio). */
export function nextScheduleJobPollDelayMs(pollIndex: number, smallBatch: boolean): number {
  const schedule = smallBatch ? SMALL_BATCH_POLL_DELAYS_MS : DEFAULT_POLL_DELAYS_MS;
  if (pollIndex <= 0) return 0;
  const slot = pollIndex - 1;
  if (slot < schedule.length) return schedule[slot]!;
  return smallBatch ? 3000 : 5000;
}

export function scheduleJobPollIntervalMs(options: {
  pollIndex: number;
  smallBatch: boolean;
  hidden: boolean;
  stalled: boolean;
}) {
  if (options.stalled) return 8000;
  if (options.hidden) return 15000;
  return nextScheduleJobPollDelayMs(options.pollIndex, options.smallBatch);
}
