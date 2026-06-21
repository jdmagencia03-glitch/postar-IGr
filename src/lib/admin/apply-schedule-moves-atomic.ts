import type { SupabaseClient } from "@supabase/supabase-js";
import { Client } from "pg";
import { ACTIVE_SLOT_STATUSES, slotTimeKey } from "@/lib/schedule-slots";
import {
  resolveDatabaseCredentialMode,
  resolveDatabaseUrl,
  type DatabaseCredentialMode,
} from "@/lib/supabase/database-url";
import type { SocialPlatform } from "@/lib/types";

const FIX_SCHEDULE_ACTIVE_STATUSES = [...ACTIVE_SLOT_STATUSES] as const;

export type AtomicScheduleMove = {
  postId: string;
  from: string;
  to: string;
  displayFrom?: string;
  displayTo?: string;
};

export type AtomicApplyPreview = {
  safeToApply: boolean;
  blockReason: string | null;
  totalFuturePosts: number;
};

const TEMP_BASE_MS = Date.UTC(2099, 0, 1, 0, 0, 0);

export type AtomicApplyReadiness = {
  atomicApplyReady: boolean;
  dbCredentialMode: DatabaseCredentialMode;
  rpcAvailable: boolean;
};

export async function getAtomicApplyReadiness(
  supabase: SupabaseClient,
): Promise<AtomicApplyReadiness> {
  const dbCredentialMode = resolveDatabaseCredentialMode();
  const rpcAvailable = await isApplyScheduleMovesRpcAvailable(supabase);

  return {
    atomicApplyReady: dbCredentialMode !== null || rpcAvailable,
    dbCredentialMode,
    rpcAvailable,
  };
}

async function isApplyScheduleMovesRpcAvailable(supabase: SupabaseClient) {
  const { error } = await supabase.rpc("apply_schedule_moves_atomic", {
    p_platform: "tiktok",
    p_account_id: "00000000-0000-0000-0000-000000000000",
    p_moves: [],
  });

  if (!error) return true;
  if (/apply_schedule_moves_atomic/i.test(error.message) && /not find/i.test(error.message)) {
    return false;
  }
  // Function exists (validation/scope errors are expected for the probe call).
  return true;
}

export class ScheduleFixApplyError extends Error {
  code: string;
  status: number;

  constructor(code: string, message: string, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

function advisoryLockKey(platform: SocialPlatform, accountId: string) {
  let hash = 0;
  const key = `apply_schedule_moves:${platform}:${accountId}`;
  for (let i = 0; i < key.length; i++) {
    hash = (hash * 31 + key.charCodeAt(i)) | 0;
  }
  return hash;
}

function tempSlotIso(index: number) {
  return new Date(TEMP_BASE_MS + index * 60_000).toISOString();
}

export function preflightScheduleMoves(params: {
  preview: AtomicApplyPreview;
  moves: AtomicScheduleMove[];
}) {
  const { preview, moves } = params;

  if (!preview.safeToApply) {
    throw new ScheduleFixApplyError(
      "apply_blocked",
      preview.blockReason ?? "Preview não está seguro para aplicar.",
    );
  }

  if (moves.length > preview.totalFuturePosts) {
    throw new ScheduleFixApplyError(
      "moves_exceed_scope",
      "Correção alteraria mais posts do que existem na fila futura.",
    );
  }

  const targetKeys = new Map<string, string>();
  for (const move of moves) {
    const key = slotTimeKey(move.to);
    const existing = targetKeys.get(key);
    if (existing && existing !== move.postId) {
      throw new ScheduleFixApplyError(
        "duplicate_target_in_moves",
        `Horário de destino duplicado entre moves: ${key}`,
      );
    }
    targetKeys.set(key, move.postId);
  }
}

export async function detectExternalSlotConflicts(params: {
  supabase: SupabaseClient;
  platform: SocialPlatform;
  accountId: string;
  moves: AtomicScheduleMove[];
}) {
  const moveIds = new Set(params.moves.map((move) => move.postId));
  const targetIsos = [...new Set(params.moves.map((move) => move.to))];

  if (!targetIsos.length) return;

  let query = params.supabase
    .from("scheduled_posts")
    .select("id, scheduled_at")
    .in("status", [...FIX_SCHEDULE_ACTIVE_STATUSES])
    .in("scheduled_at", targetIsos);

  if (params.platform === "tiktok") {
    query = query.eq("platform", "tiktok").eq("tiktok_account_id", params.accountId);
  } else {
    query = query.or(`platform.is.null,platform.eq.instagram`).eq("account_id", params.accountId);
  }

  const { data, error } = await query;
  if (error) {
    throw new Error(`Falha ao verificar conflitos externos: ${error.message}`);
  }

  const external = (data ?? []).filter((row) => !moveIds.has(row.id));
  if (external.length > 0) {
    throw new ScheduleFixApplyError(
      "external_slot_conflict",
      `Horário de destino já ocupado por post fora do escopo: ${external[0].id}`,
    );
  }
}

export async function inspectPartialApplyState(params: {
  supabase: SupabaseClient;
  platform: SocialPlatform;
  accountId: string;
  moves: AtomicScheduleMove[];
}) {
  const moveIds = new Set(params.moves.map((move) => move.postId));
  if (!moveIds.size) {
    return {
      partialApplySuspected: false,
      inTempRange: 0,
      atTarget: 0,
      atSource: 0,
      atOther: 0,
      totalMoves: 0,
      rolledBack: true,
    };
  }

  let query = params.supabase
    .from("scheduled_posts")
    .select("id, scheduled_at")
    .in("status", [...FIX_SCHEDULE_ACTIVE_STATUSES])
    .in("id", [...moveIds]);

  if (params.platform === "tiktok") {
    query = query.eq("platform", "tiktok").eq("tiktok_account_id", params.accountId);
  } else {
    query = query.or(`platform.is.null,platform.eq.instagram`).eq("account_id", params.accountId);
  }

  const { data, error } = await query;
  if (error) {
    throw new Error(`Falha ao inspecionar apply parcial: ${error.message}`);
  }

  const posts = data ?? [];
  let atTarget = 0;
  let atSource = 0;
  let atOther = 0;
  let inTempRange = 0;

  for (const post of posts) {
    if (new Date(post.scheduled_at).getTime() >= TEMP_BASE_MS) {
      inTempRange++;
    }
  }

  for (const move of params.moves) {
    const post = posts.find((row) => row.id === move.postId);
    if (!post) continue;
    const currentKey = slotTimeKey(post.scheduled_at);
    if (currentKey === slotTimeKey(move.to)) atTarget++;
    else if (currentKey === slotTimeKey(move.from)) atSource++;
    else atOther++;
  }

  const partialApplySuspected =
    inTempRange > 0 || (atTarget > 0 && (atSource > 0 || atOther > 0));

  return {
    partialApplySuspected,
    inTempRange,
    atTarget,
    atSource,
    atOther,
    totalMoves: params.moves.length,
    rolledBack: !partialApplySuspected,
  };
}

async function applyWithPgTransaction(params: {
  platform: SocialPlatform;
  accountId: string;
  moves: AtomicScheduleMove[];
}) {
  const databaseUrl = resolveDatabaseUrl();
  if (!databaseUrl) {
    throw new ScheduleFixApplyError(
      "missing_db_credentials",
      "Configure DATABASE_URL ou SUPABASE_DB_PASSWORD para apply atômico.",
      503,
    );
  }

  const client = new Client({
    connectionString: databaseUrl,
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock($1)", [
      advisoryLockKey(params.platform, params.accountId),
    ]);

    for (let index = 0; index < params.moves.length; index++) {
      const move = params.moves[index];
      await client.query(
        `update scheduled_posts
         set scheduled_at = $1, updated_at = now()
         where id = $2
           and status in ('pending', 'processing', 'retrying')`,
        [tempSlotIso(index), move.postId],
      );
    }

    for (const move of params.moves) {
      await client.query(
        `update scheduled_posts
         set scheduled_at = $1, updated_at = now()
         where id = $2
           and status in ('pending', 'processing', 'retrying')`,
        [move.to, move.postId],
      );
    }

    await client.query("COMMIT");
    return params.moves.length;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    await client.end().catch(() => undefined);
  }
}

async function applyWithRpc(params: {
  supabase: SupabaseClient;
  platform: SocialPlatform;
  accountId: string;
  moves: AtomicScheduleMove[];
}) {
  const payload = params.moves.map((move) => ({
    post_id: move.postId,
    to_ts: move.to,
  }));

  const { data, error } = await params.supabase.rpc("apply_schedule_moves_atomic", {
    p_platform: params.platform,
    p_account_id: params.accountId,
    p_moves: payload,
  });

  if (error) {
    if (/apply_schedule_moves_atomic/i.test(error.message) && /not find/i.test(error.message)) {
      return null;
    }
    throw new ScheduleFixApplyError("apply_atomic_failed", error.message, 500);
  }

  const updated =
    data && typeof data === "object" && "updated" in data
      ? Number((data as { updated: number }).updated)
      : params.moves.length;

  return Number.isFinite(updated) ? updated : params.moves.length;
}

export async function applyScheduleMovesAtomic(params: {
  supabase: SupabaseClient;
  platform: SocialPlatform;
  accountId: string;
  preview: AtomicApplyPreview;
  moves: AtomicScheduleMove[];
}) {
  const readiness = await getAtomicApplyReadiness(params.supabase);
  if (!readiness.atomicApplyReady) {
    throw new ScheduleFixApplyError(
      "missing_db_credentials",
      "Configure DATABASE_URL ou SUPABASE_DB_PASSWORD para apply atômico, ou aplique supabase/apply-schedule-moves-atomic.sql no Supabase.",
      503,
    );
  }

  preflightScheduleMoves({ preview: params.preview, moves: params.moves });
  await detectExternalSlotConflicts({
    supabase: params.supabase,
    platform: params.platform,
    accountId: params.accountId,
    moves: params.moves,
  });

  const rpcUpdated = await applyWithRpc({
    supabase: params.supabase,
    platform: params.platform,
    accountId: params.accountId,
    moves: params.moves,
  });

  if (rpcUpdated !== null) {
    return rpcUpdated;
  }

  return applyWithPgTransaction({
    platform: params.platform,
    accountId: params.accountId,
    moves: params.moves,
  });
}
