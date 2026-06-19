"use client";

import { useCallback, useEffect, useState } from "react";
import { Plus, Trash2, RefreshCw, UserRound, Share2, Flame } from "lucide-react";
import { MetaOAuthAlert } from "@/components/MetaOAuthAlert";
import { ValidatePermissionsButton } from "@/components/operations/ValidatePermissionsButton";
import { formatDateTime } from "@/lib/utils";

interface WarmupInfo {
  active: boolean;
  day: number;
  totalDays: number;
  label: string;
}

interface AccountItem {
  id: string;
  ig_user_id: string;
  ig_username: string | null;
  profile_picture_url: string | null;
  auth_provider?: string | null;
  warmup_enabled?: boolean;
  warmup_days?: number;
  warmup?: WarmupInfo;
  created_at: string;
  updated_at: string;
}

interface Props {
  oauthError?: string | null;
  connected?: string | null;
  facebookEnabled?: boolean;
}

export function AccountsManager({ oauthError, connected, facebookEnabled = true }: Props) {
  const [accounts, setAccounts] = useState<AccountItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const fetchAccounts = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/accounts", { credentials: "include", cache: "no-store" });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error ?? "Falha ao carregar contas");
      }
      setAccounts(data as AccountItem[]);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Erro ao carregar contas");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAccounts();
  }, [fetchAccounts]);

  useEffect(() => {
    if (connected) {
      fetchAccounts();
    }
  }, [connected, fetchAccounts]);

  async function handleWarmupToggle(account: AccountItem) {
    setUpdatingId(account.id);
    setMessage(null);

    try {
      const res = await fetch("/api/accounts", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          id: account.id,
          warmup_enabled: !(account.warmup_enabled ?? true),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error ?? "Falha ao atualizar aquecimento");
      }
      setAccounts((current) => current.map((a) => (a.id === account.id ? (data as AccountItem) : a)));
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Erro ao atualizar aquecimento");
    } finally {
      setUpdatingId(null);
    }
  }

  async function handleRemove(accountId: string, username: string | null) {
    const label = username ? `@${username}` : "esta conta";
    if (!confirm(`Remover ${label}? Os posts agendados dessa conta também serão apagados.`)) {
      return;
    }

    setRemovingId(accountId);
    setMessage(null);

    try {
      const res = await fetch(`/api/accounts?id=${accountId}`, {
        method: "DELETE",
        credentials: "include",
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error ?? "Falha ao remover conta");
      }
      setMessage("Conta removida com sucesso.");
      await fetchAccounts();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Erro ao remover conta");
    } finally {
      setRemovingId(null);
    }
  }

  return (
    <div className="space-y-6">
      <MetaOAuthAlert
        error={oauthError}
        connected={connected}
        facebookEnabled={facebookEnabled}
      />

      <div className="ig-panel flex flex-wrap items-center justify-between gap-4 p-4">
        <div>
          <p className="text-sm font-medium text-ig-text">
            {accounts.length} conta(s) conectada(s). Você pode agendar posts em qualquer uma delas.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={fetchAccounts}
            disabled={loading}
            className="ig-btn-secondary flex items-center gap-2 px-3 py-2 text-sm disabled:opacity-50"
          >
            <RefreshCw size={16} className={loading ? "animate-spin" : ""} />
            Atualizar
          </button>
          {facebookEnabled && (
            <a
              href="/api/auth/facebook?next=/dashboard/accounts&add_account=1"
              className="flex items-center gap-2 rounded-lg bg-ig-facebook px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:opacity-90"
            >
              <Share2 size={16} />
              Via Facebook
            </a>
          )}
          <a
            href="/api/auth/meta?next=/dashboard/accounts&add_account=1"
            className="ig-btn flex items-center gap-2 px-4 py-2 text-sm"
          >
            <Plus size={16} />
            Via Instagram
          </a>
        </div>
      </div>

      <div className="rounded-lg border border-ig-border bg-ig-elevated px-4 py-3 text-xs text-ig-muted">
        <strong className="text-ig-muted">Aquecimento (opcional):</strong> ative por conta para
        rampa gradual nos primeiros dias. Desative se quiser usar Automático ou Só hoje no agendamento.
      </div>

      <div className="rounded-lg border border-ig-border bg-ig-elevated px-4 py-3 text-xs text-ig-muted">
        <strong className="text-ig-muted">Aquecimento de contas:</strong> contas novas começam com
        rampa gradual (3→3→4→4→7 posts nos primeiros 5 dias, depois 7/dia) para reduzir risco de bloqueio.
        Use o modo <strong>Aquecimento</strong> ao agendar em massa.
      </div>

      <div className="rounded-lg border border-ig-border bg-ig-secondary px-4 py-3 text-xs text-ig-muted">
        <strong className="text-ig-text">Dica:</strong> se aparecer “função de desenvolvedor
        insuficiente”, use <strong>Via Facebook</strong> — ele detecta automaticamente todas as contas
        Instagram vinculadas às suas Páginas.
      </div>

      {message && (
        <p
          className={`rounded-lg border px-4 py-3 text-sm ${
            message.includes("sucesso")
              ? "border-ig-border bg-ig-elevated text-ig-text"
              : "border-ig-danger/30 bg-ig-danger/10 text-ig-danger"
          }`}
        >
          {message}
        </p>
      )}

      {loading && !accounts.length ? (
        <div className="rounded-xl border border-ig-border bg-ig-secondary p-8 text-center text-ig-muted">
          Carregando contas...
        </div>
      ) : null}

      {!loading && !accounts.length ? (
        <div className="rounded-xl border border-dashed border-ig-border p-12 text-center">
          <UserRound className="mx-auto mb-4 text-ig-primary" size={40} />
          <p className="mb-4 text-ig-muted">Nenhuma conta Instagram conectada ainda.</p>
          <div className="flex flex-wrap justify-center gap-2">
            {facebookEnabled && (
              <a
                href="/api/auth/facebook?next=/dashboard/accounts&add_account=1"
                className="inline-flex items-center gap-2 rounded-lg bg-ig-facebook px-4 py-2 text-sm font-medium text-white hover:opacity-90"
              >
                <Share2 size={16} />
                Conectar via Facebook
              </a>
            )}
            <a
              href="/api/auth/meta?next=/dashboard/accounts&add_account=1"
              className="ig-btn inline-flex items-center gap-2 px-4 py-2 text-sm"
            >
              <Plus size={16} />
              Conectar via Instagram
            </a>
          </div>
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        {accounts.map((account) => {
          const warmup = account.warmup;
          const warmupEnabled = account.warmup_enabled ?? true;

          return (
            <article
              key={account.id}
              className="rounded-xl border border-ig-border bg-ig-elevated p-5 shadow-sm"
            >
              <div className="flex items-start gap-4">
                {account.profile_picture_url ? (
                  <img
                    src={account.profile_picture_url}
                    alt={account.ig_username ?? "Instagram"}
                    className="h-14 w-14 rounded-full border border-ig-border object-cover"
                  />
                ) : (
                  <div className="flex h-14 w-14 items-center justify-center rounded-full border border-ig-border bg-ig-elevated text-ig-link">
                    IG
                  </div>
                )}

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="truncate text-lg font-semibold text-ig-text">
                      @{account.ig_username ?? "sem username"}
                    </p>
                    {warmup?.active && (
                      <span className="inline-flex items-center gap-1 rounded-full border border-ig-border bg-ig-secondary px-2 py-0.5 text-[10px] font-medium text-ig-muted">
                        <Flame size={10} />
                        Dia {warmup.day}/{warmup.totalDays}
                      </span>
                    )}
                    {warmup && !warmup.active && warmupEnabled && warmup.day >= warmup.totalDays && (
                      <span className="rounded-full border border-ig-border bg-ig-secondary px-2 py-0.5 text-[10px] text-ig-text">
                        Aquecido
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-ig-muted">
                    {account.auth_provider === "facebook" ? "Via Facebook" : "Via Instagram"} · ID:{" "}
                    {account.ig_user_id}
                  </p>
                  <p className="mt-1 text-xs text-ig-muted">
                    Conectada em {formatDateTime(account.created_at)}
                  </p>
                  {warmup && (
                    <p className="mt-1 text-xs text-ig-muted">{warmup.label}</p>
                  )}
                </div>
              </div>

              <label className="mt-4 flex cursor-pointer items-center justify-between gap-3 rounded-lg border border-ig-border bg-ig-elevated px-3 py-2">
                <div>
                  <p className="text-xs font-medium text-ig-text">Aquecimento automático</p>
                  <p className="text-[10px] text-ig-muted">
                    Rampa 3→3→4→4→7 nos primeiros {account.warmup_days ?? 5} dias
                  </p>
                </div>
                <input
                  type="checkbox"
                  checked={warmupEnabled}
                  disabled={updatingId === account.id}
                  onChange={() => handleWarmupToggle(account)}
                  className="h-4 w-4 rounded border-ig-border bg-ig-secondary text-ig-primary"
                />
              </label>

              <div className="mt-3">
                <ValidatePermissionsButton accountId={account.id} platform="instagram" compact />
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                <a
                  href={`/dashboard/bulk?account=${account.id}`}
                  className="rounded-lg border border-ig-border bg-ig-secondary px-3 py-1.5 text-xs text-ig-text hover:bg-ig-surface"
                >
                  Agendar posts
                </a>
                <a
                  href={`/dashboard/reports?account=${account.id}`}
                  className="rounded-lg border border-ig-border bg-ig-secondary px-3 py-1.5 text-xs text-ig-text hover:bg-ig-surface"
                >
                  Ver relatório
                </a>
                <button
                  type="button"
                  onClick={() => handleRemove(account.id, account.ig_username)}
                  disabled={removingId === account.id || accounts.length <= 1}
                  className="ml-auto flex items-center gap-1 rounded-lg border border-red-500/20 bg-ig-danger/10 px-3 py-1.5 text-xs text-ig-danger transition hover:bg-red-500/20 disabled:cursor-not-allowed disabled:opacity-40"
                  title={
                    accounts.length <= 1
                      ? "Mantenha pelo menos uma conta conectada"
                      : "Remover conta"
                  }
                >
                  <Trash2 size={14} />
                  {removingId === account.id ? "Removendo..." : "Remover"}
                </button>
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}
