/**
 * Auditoria operacional em produção (somente leitura).
 * Uso: node scripts/run-production-audit.mjs
 */
import { existsSync, readFileSync } from "fs";
import { createClient } from "@supabase/supabase-js";

function loadEnv(filePath) {
  if (!existsSync(filePath)) return;
  for (const line of readFileSync(filePath, "utf8").split(/\n/)) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    if (v && !process.env[m[1].trim()]) process.env[m[1].trim()] = v;
  }
}

for (const f of [".env.local", ".env.vercel.runtime", ".env.vercel.prod", ".env.vercel.audit"]) {
  loadEnv(f);
}

const TZ = "America/Sao_Paulo";
const ACTIVE = ["pending", "processing", "retrying"];
const now = new Date();

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

function fmt(iso) {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: TZ,
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(iso));
}

function slotKey(iso) {
  const d = new Date(iso);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })
    .formatToParts(d)
    .reduce((acc, p) => ({ ...acc, [p.type]: p.value }), {});
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

async function main() {
  const ownerId = process.env.AUDIT_OWNER_ID;
  if (!ownerId) {
    console.error("Defina AUDIT_OWNER_ID no env (owner_id da conta admin).");
    process.exit(1);
  }

  const [{ data: posts }, { data: igAccounts }, { data: ttAccounts }, { data: jobs }] =
    await Promise.all([
      sb
        .from("scheduled_posts")
        .select(
          "id,status,scheduled_at,platform,account_id,tiktok_account_id,error_message,media_id,created_at",
        )
        .eq("owner_id", ownerId)
        .order("scheduled_at", { ascending: true }),
      sb.from("instagram_accounts").select("id,username,status").eq("owner_id", ownerId),
      sb.from("tiktok_accounts").select("id,username,status,publishing_paused,token_expires_at").eq("owner_id", ownerId),
      sb
        .from("schedule_jobs")
        .select("id,status,current_step,platform,account_id,tiktok_account_id,updated_at,last_heartbeat_at,locked_by")
        .eq("owner_id", ownerId)
        .in("status", ["queued", "processing", "partial_failed"]),
    ]);

  const allPosts = posts ?? [];
  const activePosts = allPosts.filter((p) => ACTIVE.includes(p.status));

  // Duplicates
  const dupMap = new Map();
  for (const p of activePosts) {
    if (!p.scheduled_at) continue;
    const platform = p.platform ?? "instagram";
    const accountId = platform === "tiktok" ? p.tiktok_account_id : p.account_id;
    const key = `${accountId}:${platform}:${slotKey(p.scheduled_at)}`;
    const bucket = dupMap.get(key) ?? [];
    bucket.push(p.id);
    dupMap.set(key, bucket);
  }
  const duplicates = [...dupMap.entries()].filter(([, ids]) => ids.length > 1);

  // Off-grid (not :00/:15/:30/:45)
  const offGrid = activePosts.filter((p) => {
    if (!p.scheduled_at) return false;
    const d = new Date(p.scheduled_at);
    const minute = Number(
      new Intl.DateTimeFormat("en-US", { timeZone: TZ, minute: "numeric" }).format(d),
    );
    return ![0, 15, 30, 45].includes(minute);
  });

  // Overdue pending
  const overdue = allPosts.filter(
    (p) => p.status === "pending" && new Date(p.scheduled_at) < now,
  );

  // TikTok url ownership
  const ttUrlErrors = allPosts.filter((p) =>
    /url_ownership_unverified/i.test(p.error_message ?? ""),
  );

  // Success log block candidates (pending/retrying with success logs)
  const pendingWithIssues = allPosts.filter(
    (p) =>
      ["pending", "retrying", "failed", "failed_persistent"].includes(p.status) &&
      /republicação bloqueada|Log de sucesso|media_id/i.test(p.error_message ?? ""),
  );

  // Stuck jobs
  const stuckJobs = (jobs ?? []).filter((j) => {
    const updated = j.updated_at ? new Date(j.updated_at).getTime() : 0;
    return now.getTime() - updated > 10 * 60_000;
  });

  // Account lookup
  const igMap = new Map((igAccounts ?? []).map((a) => [a.id, a.username]));
  const ttMap = new Map((ttAccounts ?? []).map((a) => [a.id, a.username]));

  function accountLabel(p) {
    const platform = p.platform ?? "instagram";
    const id = platform === "tiktok" ? p.tiktok_account_id : p.account_id;
    const handle = platform === "tiktok" ? ttMap.get(id) : igMap.get(id);
    return `@${handle ?? id?.slice(0, 8)} (${platform})`;
  }

  const findings = {
    ranAt: now.toISOString(),
    ownerId,
    summary: {
      totalPosts: allPosts.length,
      activePosts: activePosts.length,
      duplicates: duplicates.length,
      offGrid: offGrid.length,
      overduePending: overdue.length,
      tiktokUrlOwnership: ttUrlErrors.length,
      igRepublicationBlock: pendingWithIssues.length,
      stuckJobs: stuckJobs.length,
    },
    critical: {
      duplicates: duplicates.slice(0, 10).map(([key, ids]) => ({ key, count: ids.length, postIds: ids.slice(0, 5) })),
      overduePending: overdue.slice(0, 10).map((p) => ({
        id: p.id.slice(0, 8),
        account: accountLabel(p),
        scheduledBr: fmt(p.scheduled_at),
      })),
      tiktokUrlOwnership: ttUrlErrors.slice(0, 5).map((p) => ({
        id: p.id.slice(0, 8),
        account: accountLabel(p),
        error: p.error_message?.slice(0, 120),
      })),
      stuckJobs: stuckJobs.map((j) => ({
        id: j.id.slice(0, 8),
        status: j.status,
        step: j.current_step,
        staleMin: Math.round((now - new Date(j.updated_at)) / 60000),
      })),
    },
    instagram: {
      republicationBlocked: pendingWithIssues
        .filter((p) => (p.platform ?? "instagram") !== "tiktok")
        .slice(0, 10)
        .map((p) => ({
          id: p.id.slice(0, 8),
          status: p.status,
          account: accountLabel(p),
          error: p.error_message?.slice(0, 100),
          hasMediaId: Boolean(p.media_id),
        })),
      accounts: (igAccounts ?? []).map((a) => ({ username: a.username, status: a.status })),
    },
    tiktok: {
      accounts: (ttAccounts ?? []).map((a) => ({
        username: a.username,
        status: a.status,
        paused: a.publishing_paused,
        tokenExpires: a.token_expires_at,
      })),
      offGridSample: offGrid
        .filter((p) => p.platform === "tiktok")
        .slice(0, 15)
        .map((p) => ({ br: fmt(p.scheduled_at), id: p.id.slice(0, 8) })),
    },
    schedule: {
      offGridCount: offGrid.length,
      offGridSample: offGrid.slice(0, 15).map((p) => ({
        account: accountLabel(p),
        br: fmt(p.scheduled_at),
      })),
    },
    cron: {
      cronSecretConfigured: Boolean(process.env.CRON_SECRET?.trim()),
      overdueCount: overdue.length,
    },
  };

  console.log(JSON.stringify(findings, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
