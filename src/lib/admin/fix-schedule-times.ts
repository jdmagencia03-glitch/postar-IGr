import type { SupabaseClient } from "@supabase/supabase-js";
import { generateWarmupSchedule } from "@/lib/account-warmup";
import { TIKTOK_SCHEDULE_OFFSET_MINUTES } from "@/lib/multiplatform/types";
import { getOwnerAccountRefs, type OwnerAccountRef } from "@/lib/posts";
import {
  applyScheduleMovesAtomic,
  getAtomicApplyReadiness,
  inspectPartialApplyState,
} from "@/lib/admin/apply-schedule-moves-atomic";
import { inspectWarmupSchedule } from "@/lib/admin/warmup-schedule-inspect";
import { resolveScheduleModeForAccount } from "@/lib/schedule-redistribute";
import {
  ACTIVE_SLOT_STATUSES,
  detectDuplicateSlots,
  fillScheduleSlots,
  slotTimeKey,
  slotTimeLabel,
} from "@/lib/schedule-slots";
import {
  buildAutoTimeSlots,
  ensureFutureScheduleSlot,
  formatTimeSlot,
  parseCustomSchedulePayload,
  parseTimeSlots,
} from "@/lib/smart-schedule";
import { APP_TIMEZONE, zonedDateTimeToUtc } from "@/lib/timezone";
import type { SocialPlatform } from "@/lib/types";

export const FIX_SCHEDULE_ACTIVE_STATUSES = [...ACTIVE_SLOT_STATUSES] as const;

const MAX_FIRST_POST_SHIFT_MS = 24 * 60 * 60 * 1000;
const MAX_LAST_END_PULLBACK_MS = 24 * 60 * 60 * 1000;

export type ScheduleMove = {
  postId: string;
  from: string;
  to: string;
  displayFrom: string;
  displayTo: string;
};

export type GradeSource = "warmup" | "custom_explicit" | "custom_generated" | "auto";

export type ScheduleRangeSummary = {
  first: string | null;
  last: string | null;
};

export type AccountScheduleFixPreview = {
  accountId: string;
  platform: SocialPlatform;
  accountHandle: string;
  scheduleMode: string;
  gradeSource: GradeSource;
  gridLabel: string;
  timeSlots: Array<{ hour: number; minute: number }>;
  postsPerDay: number;
  totalFuturePosts: number;
  postsToChange: number;
  duplicateGroups: number;
  offGridPosts: number;
  firstCurrent: string | null;
  firstNew: string | null;
  lastCurrent: string | null;
  lastNew: string | null;
  currentRange: ScheduleRangeSummary;
  newRange: ScheduleRangeSummary;
  moves: ScheduleMove[];
  scope: {
    platform: SocialPlatform;
    accountId: string;
    accountHandle: string;
    otherPlatformsUntouched: true;
  };
  warnings: string[];
  safeToApply: boolean;
  blockReason: string | null;
};

export type ScheduleFixPreviewResult = {
  ok: true;
  dryRun: true;
  ranAt: string;
  timezone: string;
  scope: {
    platform: SocialPlatform;
    accountId: string;
    accountHandle: string;
    otherPlatformsUntouched: true;
  };
  account: AccountScheduleFixPreview;
  totals: {
    postsToChange: number;
    duplicateGroups: number;
    offGridPosts: number;
  };
};

export type ScheduleFixVerifyResult = {
  ok: boolean;
  duplicateGroups: number;
  offGridPosts: number;
  postCountBefore: number;
  postCountAfter: number;
  postCountDelta: number;
  checks: Array<{ id: string; ok: boolean; detail: string }>;
};

export class ScheduleFixScopeError extends Error {
  code: string;
  status: number;

  constructor(code: string, message: string, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

function handle(ref: OwnerAccountRef) {
  const u = ref.username?.replace(/^@/, "") ?? ref.id.slice(0, 8);
  return `@${u}`;
}

function formatGridLabel(slots: Array<{ hour: number; minute: number }>) {
  if (!slots.length) return "modo aquecimento (rampa TikTok)";
  return slots.map((slot) => formatTimeSlot(slot.hour, slot.minute)).join(", ");
}

function parseSlotKey(key: string) {
  const [datePart, timePart] = key.split("T");
  const [year, month, day] = datePart.split("-").map(Number);
  const [hour, minute] = timePart.split(":").map(Number);
  return zonedDateTimeToUtc(year, month, day, hour, minute);
}

function applyPlatformOffset(date: Date, platform: SocialPlatform, now?: Date) {
  if (platform !== "tiktok") return date;
  const withOffset = new Date(date.getTime() + TIKTOK_SCHEDULE_OFFSET_MINUTES * 60_000);
  if (!now || withOffset.getTime() >= now.getTime()) return withOffset;
  return ensureFutureScheduleSlot(withOffset, now);
}

type FixPostRow = {
  id: string;
  scheduled_at: string;
  created_at?: string | null;
};

function sortPostsForFix(posts: FixPostRow[]) {
  return [...posts].sort((a, b) => {
    const scheduledDiff =
      new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime();
    if (scheduledDiff !== 0) return scheduledDiff;
    const aCreated = new Date(a.created_at ?? a.scheduled_at).getTime();
    const bCreated = new Date(b.created_at ?? b.scheduled_at).getTime();
    if (aCreated !== bCreated) return aCreated - bCreated;
    return a.id.localeCompare(b.id);
  });
}

function buildScheduleRange(isoList: string[]): ScheduleRangeSummary {
  const times = isoList
    .map((iso) => new Date(iso).getTime())
    .filter((value) => Number.isFinite(value));
  if (!times.length) {
    return { first: null, last: null };
  }
  return {
    first: slotTimeKey(new Date(Math.min(...times)).toISOString()),
    last: slotTimeKey(new Date(Math.max(...times)).toISOString()),
  };
}

function buildTargetMap(posts: FixPostRow[], sorted: FixPostRow[], targets: string[]) {
  const targetById = new Map<string, string>();
  for (let index = 0; index < sorted.length; index++) {
    const post = sorted[index];
    targetById.set(post.id, targets[index] ?? post.scheduled_at);
  }
  for (const post of posts) {
    if (!targetById.has(post.id)) {
      targetById.set(post.id, post.scheduled_at);
    }
  }
  return targetById;
}

function buildScheduleMoves(params: {
  posts: FixPostRow[];
  targets: string[];
  maxMoves: number;
}): ScheduleMove[] {
  const movesByPost = new Map<string, ScheduleMove>();

  for (let index = 0; index < params.posts.length; index++) {
    const post = params.posts[index];
    const to = params.targets[index] ?? post.scheduled_at;
    const fromKey = slotTimeKey(post.scheduled_at);
    const toKey = slotTimeKey(to);

    if (fromKey === toKey) continue;

    movesByPost.set(post.id, {
      postId: post.id,
      from: post.scheduled_at,
      to,
      displayFrom: slotTimeLabel(post.scheduled_at),
      displayTo: slotTimeLabel(to),
    });
  }

  return [...movesByPost.values()].slice(0, params.maxMoves);
}

function isUnsafeBlockReason(code: string | null) {
  return code === "unsafe_date_shift" || code === "unsafe_queue_compression";
}

function isOnGrid(iso: string, timeSlots: Array<{ hour: number; minute: number }>) {
  if (!timeSlots.length) return true;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: APP_TIMEZONE,
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  })
    .formatToParts(new Date(iso))
    .reduce<Record<string, string>>((acc, part) => {
      if (part.type !== "literal") acc[part.type] = part.value;
      return acc;
    }, {});
  const hour = Number(parts.hour);
  const minute = Number(parts.minute);
  return timeSlots.some((slot) => slot.hour === hour && slot.minute === minute);
}

function countOffGrid(
  posts: Array<{ scheduled_at: string }>,
  timeSlots: Array<{ hour: number; minute: number }>,
) {
  if (!timeSlots.length) return 0;
  return posts.filter((post) => !isOnGrid(post.scheduled_at, timeSlots)).length;
}

export function assertFixScope(params: {
  platform?: SocialPlatform;
  accountId?: string;
}) {
  if (!params.platform || !params.accountId) {
    throw new ScheduleFixScopeError(
      "scope_required",
      "Escolha uma conta e plataforma antes de aplicar.",
    );
  }
}

export async function resolveAccountRef(
  supabase: SupabaseClient,
  ownerId: string,
  platform: SocialPlatform,
  accountId: string,
) {
  const refs = await getOwnerAccountRefs(supabase, ownerId);
  const ref = refs.find((row) => row.id === accountId && row.platform === platform);
  if (!ref) {
    throw new ScheduleFixScopeError(
      "account_not_found",
      "Conta não encontrada para esta plataforma.",
      404,
    );
  }
  return ref;
}

async function resolveScheduleConfig(
  supabase: SupabaseClient,
  platform: SocialPlatform,
  accountId: string,
) {
  const scheduleMode = await resolveScheduleModeForAccount(supabase, platform, accountId);
  const accountCol = platform === "tiktok" ? "tiktok_account_id" : "account_id";
  const jobCol = accountCol;

  const [{ data: batches }, { data: jobs }] = await Promise.all([
    supabase
      .from("upload_batches")
      .select("schedule_mode, custom_schedule")
      .eq("platform", platform)
      .eq(accountCol, accountId)
      .order("created_at", { ascending: false })
      .limit(10),
    supabase
      .from("schedule_jobs")
      .select("schedule_mode, config")
      .eq(jobCol, accountId)
      .order("created_at", { ascending: false })
      .limit(5),
  ]);

  type CustomSchedulePayload = {
    posts_per_day: number;
    time_slots?: string[];
    start_time?: string;
    end_time?: string;
  };

  const jobCustom = jobs?.find((row) => {
    if (row.schedule_mode !== "custom" || !row.config || typeof row.config !== "object") {
      return false;
    }
    const config = row.config as { custom_schedule?: CustomSchedulePayload };
    return Boolean(config.custom_schedule);
  });

  const customPayload: CustomSchedulePayload | undefined =
    (batches?.find(
      (row) =>
        row.schedule_mode === "custom" &&
        row.custom_schedule &&
        typeof row.custom_schedule === "object",
    )?.custom_schedule as CustomSchedulePayload | undefined) ??
    (jobCustom
      ? (jobCustom.config as { custom_schedule?: CustomSchedulePayload }).custom_schedule
      : undefined);

  if (scheduleMode === "warmup") {
    return {
      scheduleMode: "warmup" as const,
      gradeSource: "warmup" as GradeSource,
      timeSlots: [] as Array<{ hour: number; minute: number }>,
      postsPerDay: 7,
    };
  }

  if (customPayload && typeof customPayload === "object") {
    const payload = customPayload;
    const explicit = parseTimeSlots(payload.time_slots ?? []);
    if (explicit.length > 0) {
      const postsPerDay = payload.posts_per_day || explicit.length;
      return {
        scheduleMode: "custom" as const,
        gradeSource: "custom_explicit" as GradeSource,
        timeSlots: explicit.slice(0, postsPerDay),
        postsPerDay,
      };
    }

    const generated = parseCustomSchedulePayload(payload);
    return {
      scheduleMode: "custom" as const,
      gradeSource: "custom_generated" as GradeSource,
      timeSlots: generated.timeSlots,
      postsPerDay: generated.postsPerDay,
    };
  }

  const postsPerDay = 10;
  return {
    scheduleMode: scheduleMode === "custom" ? "auto" : scheduleMode,
    gradeSource: "auto" as GradeSource,
    timeSlots: buildAutoTimeSlots(postsPerDay),
    postsPerDay,
  };
}

async function fetchFutureActivePosts(
  supabase: SupabaseClient,
  platform: SocialPlatform,
  accountId: string,
  now: Date,
) {
  let query = supabase
    .from("scheduled_posts")
    .select("id, scheduled_at, status, created_at")
    .in("status", [...FIX_SCHEDULE_ACTIVE_STATUSES])
    .gte("scheduled_at", now.toISOString())
    .order("scheduled_at", { ascending: true });

  if (platform === "tiktok") {
    query = query.eq("platform", "tiktok").eq("tiktok_account_id", accountId);
  } else {
    query = query.or(`platform.is.null,platform.eq.instagram`).eq("account_id", accountId);
  }

  const { data, error } = await query;
  if (error) throw new Error(`Falha ao buscar posts: ${error.message}`);
  return data ?? [];
}

function evaluateApplySafety(
  preview: Omit<
    AccountScheduleFixPreview,
    "scope" | "warnings" | "safeToApply" | "blockReason"
  >,
): { warnings: string[]; safeToApply: boolean; blockReason: string | null } {
  const warnings: string[] = [];

  if (preview.platform === "instagram" && preview.gradeSource !== "custom_explicit") {
    return {
      warnings,
      safeToApply: false,
      blockReason:
        preview.gradeSource === "custom_generated"
          ? "Instagram com grade gerada automaticamente (intervalos irregulares). Configure time_slots explícitos no lote antes de aplicar."
          : "Instagram exige grade explícita (time_slots) configurada no lote — não use distribuição automática.",
    };
  }

  if (preview.platform === "tiktok" && preview.gradeSource === "auto") {
    return {
      warnings,
      safeToApply: false,
      blockReason:
        "TikTok sem modo aquecimento ou grade custom detectada. Use conta em warmup ou configure time_slots.",
    };
  }

  const minFrom = preview.currentRange.first
    ? parseSlotKey(preview.currentRange.first).getTime()
    : null;
  const maxFrom = preview.currentRange.last
    ? parseSlotKey(preview.currentRange.last).getTime()
    : null;
  const minTo = preview.newRange.first
    ? parseSlotKey(preview.newRange.first).getTime()
    : null;
  const maxTo = preview.newRange.last
    ? parseSlotKey(preview.newRange.last).getTime()
    : null;

  if (minFrom !== null && minTo !== null) {
    const shiftMs = minTo - minFrom;
    if (shiftMs > MAX_FIRST_POST_SHIFT_MS) {
      return {
        warnings,
        safeToApply: false,
        blockReason: "unsafe_date_shift",
      };
    }
    if (shiftMs > 2 * 60 * 60 * 1000) {
      warnings.push(
        `Primeiro post avançaria ${Math.round(shiftMs / 3_600_000)}h — revise o preview antes de aplicar.`,
      );
    }
  }

  if (maxFrom !== null && maxTo !== null) {
    const endPullbackMs = maxFrom - maxTo;
    if (endPullbackMs > MAX_LAST_END_PULLBACK_MS) {
      return {
        warnings,
        safeToApply: false,
        blockReason: "unsafe_queue_compression",
      };
    }
    if (endPullbackMs > 2 * 60 * 60 * 1000) {
      warnings.push(
        `Último post terminaria ${Math.round(endPullbackMs / 3_600_000)}h antes do atual — fila compactada demais.`,
      );
    }
  }

  if (preview.postsToChange > preview.totalFuturePosts) {
    return {
      warnings,
      safeToApply: false,
      blockReason: "Correção alteraria mais posts do que existem na fila futura.",
    };
  }

  if (preview.gradeSource === "custom_generated") {
    warnings.push(
      "Grade calculada por intervalo (não explícita): horários podem parecer irregulares.",
    );
  }

  if (preview.postsToChange === 0 && preview.duplicateGroups === 0 && preview.offGridPosts === 0) {
    warnings.push("Nenhuma alteração necessária nesta conta.");
  }

  return { warnings, safeToApply: true, blockReason: null };
}

export async function previewAccountScheduleFix(params: {
  supabase: SupabaseClient;
  ref: OwnerAccountRef;
  now?: Date;
}): Promise<AccountScheduleFixPreview> {
  const now = params.now ?? new Date();
  const { ref } = params;
  const config = await resolveScheduleConfig(params.supabase, ref.platform, ref.id);
  const posts = await fetchFutureActivePosts(
    params.supabase,
    ref.platform,
    ref.id,
    now,
  );

  const duplicateGroups = detectDuplicateSlots(posts);
  const offGridPosts =
    config.scheduleMode === "warmup" ? 0 : countOffGrid(posts, config.timeSlots);

  let moves: ScheduleMove[] = [];
  let targetSchedule: string[] = posts.map((post) => post.scheduled_at);

  if (config.scheduleMode === "warmup") {
    const sorted = sortPostsForFix(posts);
    const firstScheduledAt = new Date(sorted[0].scheduled_at);
    const baseSchedule = generateWarmupSchedule({
      count: sorted.length,
      firstScheduledAt,
      now,
    });
    targetSchedule = baseSchedule.map((slot) =>
      applyPlatformOffset(slot, ref.platform, now).toISOString(),
    );
    moves = buildScheduleMoves({
      posts: sorted,
      targets: targetSchedule,
      maxMoves: posts.length,
    });
  } else if (
    posts.length > 0 &&
    config.timeSlots.length > 0 &&
    config.gradeSource === "custom_explicit"
  ) {
    const sorted = sortPostsForFix(posts);
    const anchorDate = new Date(sorted[0].scheduled_at);

    const schedule = fillScheduleSlots({
      count: sorted.length,
      existing: [],
      timeSlots: config.timeSlots,
      postsPerDay: config.postsPerDay,
      now,
      anchorDate,
    }).map((slot) => applyPlatformOffset(slot, ref.platform, now).toISOString());

    targetSchedule = sorted.map((post, index) => schedule[index] ?? post.scheduled_at);
    moves = buildScheduleMoves({
      posts: sorted,
      targets: targetSchedule,
      maxMoves: posts.length,
    });
  }

  const sorted = sortPostsForFix(posts);
  const targetById = buildTargetMap(posts, sorted, targetSchedule);
  const currentIsos = posts.map((post) => post.scheduled_at);
  const newIsos = posts.map((post) => targetById.get(post.id) ?? post.scheduled_at);
  const currentRange = buildScheduleRange(currentIsos);
  const newRange = buildScheduleRange(newIsos);

  const base = {
    accountId: ref.id,
    platform: ref.platform,
    accountHandle: handle(ref),
    scheduleMode: config.scheduleMode,
    gradeSource: config.gradeSource,
    gridLabel: formatGridLabel(config.timeSlots),
    timeSlots: config.timeSlots,
    postsPerDay: config.postsPerDay,
    totalFuturePosts: posts.length,
    postsToChange: moves.length,
    duplicateGroups: duplicateGroups.length,
    offGridPosts,
    firstCurrent: currentRange.first,
    firstNew: newRange.first,
    lastCurrent: currentRange.last,
    lastNew: newRange.last,
    currentRange,
    newRange,
    moves,
  };

  const safety = evaluateApplySafety(base);

  return {
    ...base,
    scope: {
      platform: ref.platform,
      accountId: ref.id,
      accountHandle: handle(ref),
      otherPlatformsUntouched: true,
    },
    warnings: safety.warnings,
    safeToApply: safety.safeToApply,
    blockReason: safety.blockReason,
  };
}

export async function previewScheduleFix(params: {
  supabase: SupabaseClient;
  ownerId: string;
  platform: SocialPlatform;
  accountId: string;
}): Promise<ScheduleFixPreviewResult> {
  assertFixScope(params);
  const ref = await resolveAccountRef(
    params.supabase,
    params.ownerId,
    params.platform,
    params.accountId,
  );

  const account = await previewAccountScheduleFix({ supabase: params.supabase, ref });

  return {
    ok: true,
    dryRun: true,
    ranAt: new Date().toISOString(),
    timezone: APP_TIMEZONE,
    scope: account.scope,
    account,
    totals: {
      postsToChange: account.postsToChange,
      duplicateGroups: account.duplicateGroups,
      offGridPosts: account.offGridPosts,
    },
  };
}

export function assertApplySafe(preview: AccountScheduleFixPreview) {
  if (!preview.safeToApply) {
    const code = isUnsafeBlockReason(preview.blockReason)
      ? preview.blockReason!
      : "apply_blocked";
    const message =
      preview.blockReason === "unsafe_date_shift"
        ? "A correção moveria a fila para muito longe no futuro."
        : preview.blockReason === "unsafe_queue_compression"
          ? "A correção compactaria demais a fila — o fim ficaria antes do esperado."
          : (preview.blockReason ?? "Preview não está seguro para aplicar.");
    throw new ScheduleFixScopeError(code, message, isUnsafeBlockReason(code) ? 409 : 400);
  }
}

export async function inspectScheduleFixApply(params: {
  supabase: SupabaseClient;
  ownerId: string;
  platform: SocialPlatform;
  accountId: string;
}) {
  assertFixScope(params);
  const ref = await resolveAccountRef(
    params.supabase,
    params.ownerId,
    params.platform,
    params.accountId,
  );
  const preview = await previewAccountScheduleFix({ supabase: params.supabase, ref });
  const [applyState, atomicApply, warmup] = await Promise.all([
    inspectPartialApplyState({
      supabase: params.supabase,
      platform: params.platform,
      accountId: params.accountId,
      moves: preview.moves,
    }),
    getAtomicApplyReadiness(params.supabase),
    inspectWarmupSchedule({
      supabase: params.supabase,
      platform: params.platform,
      accountId: params.accountId,
      scheduleMode: preview.scheduleMode,
      gradeSource: preview.gradeSource,
    }),
  ]);
  return { preview, applyState, atomicApply, warmup };
}

export async function applyAccountScheduleFix(params: {
  supabase: SupabaseClient;
  ref: OwnerAccountRef;
}) {
  const { ref } = params;
  const preview = await previewAccountScheduleFix(params);
  assertApplySafe(preview);

  const postsUpdated = await applyScheduleMovesAtomic({
    supabase: params.supabase,
    platform: ref.platform,
    accountId: ref.id,
    preview,
    moves: preview.moves,
  });

  for (const move of preview.moves) {
    console.info("[fix-schedule-times]", {
      accountId: ref.id,
      platform: ref.platform,
      postId: move.postId,
      from: move.from,
      to: move.to,
    });
  }

  const afterPreview = await previewAccountScheduleFix(params);
  return { afterPreview, postsUpdated };
}

export async function applyScheduleFix(params: {
  supabase: SupabaseClient;
  ownerId: string;
  platform: SocialPlatform;
  accountId: string;
}) {
  assertFixScope(params);
  const ref = await resolveAccountRef(
    params.supabase,
    params.ownerId,
    params.platform,
    params.accountId,
  );

  const beforeCount = (
    await fetchFutureActivePosts(params.supabase, ref.platform, ref.id, new Date())
  ).length;

  const { afterPreview: account, postsUpdated } = await applyAccountScheduleFix({
    supabase: params.supabase,
    ref,
  });

  const verification = await verifyScheduleFix({
    supabase: params.supabase,
    ownerId: params.ownerId,
    platform: params.platform,
    accountId: params.accountId,
    postCountBefore: beforeCount,
  });

  return {
    ok: true,
    applied: true,
    platform: params.platform,
    accountId: params.accountId,
    postsUpdated,
    dryRun: false,
    ranAt: new Date().toISOString(),
    timezone: APP_TIMEZONE,
    scope: account.scope,
    account,
    totals: {
      postsChanged: postsUpdated,
    },
    verification: {
      ok: verification.ok,
      duplicateGroups: verification.duplicateGroups,
      offGridPosts: verification.offGridPosts,
      timezone: APP_TIMEZONE,
      otherPlatformsUntouched: true,
      postCountBefore: verification.postCountBefore,
      postCountAfter: verification.postCountAfter,
      checks: verification.checks,
    },
  };
}

export async function verifyScheduleFix(params: {
  supabase: SupabaseClient;
  ownerId: string;
  platform: SocialPlatform;
  accountId: string;
  postCountBefore?: number;
}): Promise<ScheduleFixVerifyResult> {
  assertFixScope(params);
  const preview = await previewScheduleFix({
    supabase: params.supabase,
    ownerId: params.ownerId,
    platform: params.platform,
    accountId: params.accountId,
  });

  const postCountAfter = preview.account.totalFuturePosts;
  const postCountBefore = params.postCountBefore ?? postCountAfter;
  const postCountDelta = postCountAfter - postCountBefore;

  const checks = [
    {
      id: "no-duplicates",
      ok: preview.totals.duplicateGroups === 0,
      detail:
        preview.totals.duplicateGroups === 0
          ? "Nenhum horário duplicado"
          : `${preview.totals.duplicateGroups} grupo(s) duplicado(s) restante(s)`,
    },
    {
      id: "no-off-grid",
      ok: preview.totals.offGridPosts === 0,
      detail:
        preview.totals.offGridPosts === 0
          ? "Todos os posts futuros na grade"
          : `${preview.totals.offGridPosts} post(s) fora da grade`,
    },
    {
      id: "post-count-stable",
      ok: postCountDelta === 0,
      detail:
        postCountDelta === 0
          ? "Contagem de posts inalterada — nenhum vídeo removido"
          : `Contagem mudou em ${postCountDelta}`,
    },
    {
      id: "timezone-br",
      ok: true,
      detail: `Horários em ${APP_TIMEZONE}`,
    },
    {
      id: "platform-isolated",
      ok: true,
      detail: `Somente ${preview.scope.platform} · ${preview.scope.accountHandle}`,
    },
  ];

  return {
    ok: checks.every((check) => check.ok),
    duplicateGroups: preview.totals.duplicateGroups,
    offGridPosts: preview.totals.offGridPosts,
    postCountBefore,
    postCountAfter,
    postCountDelta,
    checks,
  };
}
