"use client";

import { useCallback, useEffect, useState } from "react";
import {
  RefreshCw,
  Users,
  UserPlus,
  ImageIcon,
  CheckCircle2,
  AlertCircle,
} from "lucide-react";
import { formatDateTime } from "@/lib/utils";

type AccountStatus = "active" | "error";

interface AccountOption {
  id: string;
  ig_username: string | null;
}

interface Props {
  accounts: AccountOption[];
  initialAccountId?: string;
}

interface InstagramStats {
  account_status: AccountStatus;
  status_message: string;
  account_id?: string;
  error_code?: number;
  username?: string;
  name?: string;
  account_type?: string;
  profile_picture_url?: string;
  followers_count: number;
  follows_count: number;
  media_count: number;
  fetched_at: string;
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("pt-BR").format(value);
}

export function ReportsInsights({ accounts, initialAccountId }: Props) {
  const [selectedAccountId, setSelectedAccountId] = useState(
    initialAccountId ?? accounts[0]?.id ?? "",
  );
  const [stats, setStats] = useState<InstagramStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const fetchStats = useCallback(async () => {
    if (!selectedAccountId) return;

    setLoading(true);
    setFetchError(null);

    try {
      const res = await fetch(`/api/instagram/stats?account_id=${selectedAccountId}`, {
        credentials: "include",
        cache: "no-store",
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error ?? "Falha ao atualizar dados do Instagram");
      }

      setStats(data as InstagramStats);
    } catch (err) {
      setFetchError(err instanceof Error ? err.message : "Erro desconhecido");
    } finally {
      setLoading(false);
    }
  }, [selectedAccountId]);

  useEffect(() => {
    fetchStats();
    const interval = setInterval(fetchStats, 60_000);
    return () => clearInterval(interval);
  }, [fetchStats]);

  const accountStatus = stats?.account_status ?? "error";
  const isActive = accountStatus === "active";

  return (
    <section className="mb-8 rounded-2xl border border-white/10 bg-gradient-to-br from-pink-500/10 via-purple-500/5 to-transparent p-6">
      {accounts.length > 1 && (
        <div className="mb-4">
          <label className="mb-2 block text-sm text-zinc-400">Conta para métricas</label>
          <select
            value={selectedAccountId}
            onChange={(e) => setSelectedAccountId(e.target.value)}
            className="w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-white sm:max-w-xs"
          >
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>
                @{account.ig_username}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="mb-6 flex items-start justify-between gap-4">
        <div className="flex items-center gap-4">
          {stats?.profile_picture_url ? (
            <img
              src={stats.profile_picture_url}
              alt={stats.username ?? "Instagram"}
              className="h-16 w-16 rounded-full border border-white/10 object-cover"
            />
          ) : (
            <div className="flex h-16 w-16 items-center justify-center rounded-full border border-white/10 bg-white/5 text-xl text-pink-300">
              IG
            </div>
          )}
          <div>
            <p className="text-lg font-semibold text-white">
              @{stats?.username ?? "carregando..."}
            </p>
            <p className="text-sm text-zinc-400">
              {stats?.name || stats?.account_type || "Conta Instagram"}
            </p>
            {stats?.fetched_at && (
              <p className="mt-1 text-xs text-zinc-500">
                Atualizado em {formatDateTime(stats.fetched_at)}
              </p>
            )}
          </div>
        </div>

        <button
          type="button"
          onClick={fetchStats}
          disabled={loading}
          className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-zinc-200 transition hover:bg-white/10 disabled:opacity-50"
        >
          <RefreshCw size={16} className={loading ? "animate-spin" : ""} />
          Atualizar
        </button>
      </div>

      <div className="mb-6 grid gap-3 sm:grid-cols-2">
        <div
          className={`rounded-xl border p-4 transition ${
            isActive
              ? "border-emerald-500/40 bg-emerald-500/10"
              : "border-white/10 bg-black/20 opacity-60"
          }`}
        >
          <div className="mb-2 flex items-center gap-2">
            <CheckCircle2
              size={18}
              className={isActive ? "text-emerald-300" : "text-zinc-500"}
            />
            <span
              className={`font-semibold ${isActive ? "text-emerald-300" : "text-zinc-500"}`}
            >
              Ativo
            </span>
            {isActive && (
              <span className="ml-auto h-2.5 w-2.5 animate-pulse rounded-full bg-emerald-400" />
            )}
          </div>
          <p className="text-sm text-zinc-400">Conta suave e pronta para publicar</p>
        </div>

        <div
          className={`rounded-xl border p-4 transition ${
            !isActive
              ? "border-red-500/40 bg-red-500/10"
              : "border-white/10 bg-black/20 opacity-60"
          }`}
        >
          <div className="mb-2 flex items-center gap-2">
            <AlertCircle
              size={18}
              className={!isActive ? "text-red-300" : "text-zinc-500"}
            />
            <span
              className={`font-semibold ${!isActive ? "text-red-300" : "text-zinc-500"}`}
            >
              Erro
            </span>
            {!isActive && (
              <span className="ml-auto h-2.5 w-2.5 animate-pulse rounded-full bg-red-400" />
            )}
          </div>
          <p className="text-sm text-zinc-400">Conta caiu, token expirou ou com problema</p>
        </div>
      </div>

      {stats?.status_message && (
        <div
          className={`mb-4 rounded-lg border px-4 py-3 text-sm ${
            isActive
              ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200"
              : "border-red-500/30 bg-red-500/10 text-red-200"
          }`}
        >
          {stats.status_message}
          {!isActive && (
            <a
              href="/api/auth/meta?next=/dashboard/reports"
              className="mt-2 block font-medium text-pink-300 hover:underline"
            >
              Reconectar esta conta →
            </a>
          )}
          <a
            href="/dashboard/accounts"
            className="mt-2 block text-xs text-zinc-400 hover:text-pink-300"
          >
            Gerenciar todas as contas
          </a>
        </div>
      )}

      {fetchError && (
        <p className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {fetchError}
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-white/10 bg-black/20 p-4">
          <div className="mb-2 flex items-center gap-2 text-zinc-400">
            <Users size={16} />
            <span className="text-sm">Seguidores</span>
          </div>
          <p className="text-3xl font-bold text-emerald-300">
            {isActive && stats ? formatNumber(stats.followers_count) : "—"}
          </p>
          <p className="mt-1 text-xs text-zinc-500">Atualização automática a cada 60s</p>
        </div>

        <div className="rounded-xl border border-white/10 bg-black/20 p-4">
          <div className="mb-2 flex items-center gap-2 text-zinc-400">
            <UserPlus size={16} />
            <span className="text-sm">Seguindo</span>
          </div>
          <p className="text-3xl font-bold text-blue-300">
            {isActive && stats ? formatNumber(stats.follows_count) : "—"}
          </p>
        </div>

        <div className="rounded-xl border border-white/10 bg-black/20 p-4">
          <div className="mb-2 flex items-center gap-2 text-zinc-400">
            <ImageIcon size={16} />
            <span className="text-sm">Posts no Instagram</span>
          </div>
          <p className="text-3xl font-bold text-pink-300">
            {isActive && stats ? formatNumber(stats.media_count) : "—"}
          </p>
        </div>
      </div>
    </section>
  );
}
