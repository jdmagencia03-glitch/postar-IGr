"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Loader2, Music2, Plus, RefreshCw, ShieldCheck, Trash2 } from "lucide-react";
import { formatDateTime } from "@/lib/utils";

export interface TikTokAccountItem {
  id: string;
  open_id: string;
  username: string | null;
  display_name: string | null;
  profile_picture_url: string | null;
  scopes?: string | null;
  status?: string;
  token_valid?: boolean;
  token_expires_at?: string | null;
  publishing_paused?: boolean;
  last_validated_at?: string | null;
  last_validation_error?: string | null;
  creator_max_duration_sec?: number | null;
  created_at: string;
  updated_at: string;
}

interface Props {
  connectHref?: string;
  compact?: boolean;
  onAccountsChange?: (accounts: TikTokAccountItem[]) => void;
}

export function TikTokAccountsSection({
  connectHref = "/api/auth/tiktok?next=/dashboard/tiktok&add_account=1",
  compact = false,
  onAccountsChange,
}: Props) {
  const [accounts, setAccounts] = useState<TikTokAccountItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [validatingId, setValidatingId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const fetchAccounts = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/tiktok/accounts", { credentials: "include", cache: "no-store" });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(String(data.error ?? "Falha ao carregar contas TikTok"));
      }
      const next = data as TikTokAccountItem[];
      setAccounts(next);
      onAccountsChange?.(next);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Erro ao carregar contas TikTok");
    } finally {
      setLoading(false);
    }
  }, [onAccountsChange]);

  useEffect(() => {
    fetchAccounts();
  }, [fetchAccounts]);

  async function handleValidate(accountId: string) {
    setValidatingId(accountId);
    setMessage(null);
    try {
      const res = await fetch("/api/tiktok/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ account_id: accountId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(String(data.error ?? "Falha na validação"));
      setMessage(data.summary ?? "Validação concluída");
      await fetchAccounts();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Erro na validação");
    } finally {
      setValidatingId(null);
    }
  }

  async function handleDisconnect(accountId: string, label: string) {
    if (!confirm(`Desconectar ${label}? Os posts TikTok agendados também serão apagados.`)) {
      return;
    }

    setRemovingId(accountId);
    setMessage(null);

    try {
      const res = await fetch("/api/tiktok/disconnect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ account_id: accountId }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(String(data.error ?? "Falha ao desconectar conta"));
      }
      setMessage("Conta TikTok desconectada.");
      await fetchAccounts();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Erro ao desconectar conta");
    } finally {
      setRemovingId(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-ig-muted">
          {accounts.length} conta(s) TikTok conectada(s)
        </p>
        <a href={connectHref} className="ig-btn inline-flex items-center gap-2 px-4 py-2 text-sm">
          <Plus size={16} />
          Conectar TikTok
        </a>
      </div>

      {message && (
        <p className="rounded-lg border border-ig-border bg-ig-secondary px-4 py-3 text-sm text-ig-text">
          {message}
        </p>
      )}

      {loading && !accounts.length ? (
        <div className="flex items-center gap-2 rounded-xl border border-ig-border bg-ig-secondary p-6 text-sm text-ig-muted">
          <Loader2 size={16} className="animate-spin" />
          Carregando contas TikTok...
        </div>
      ) : null}

      {!loading && !accounts.length ? (
        <div className="rounded-xl border border-dashed border-ig-border p-10 text-center">
          <Music2 className="mx-auto mb-3 text-ig-primary" size={36} />
          <p className="mb-4 text-ig-muted">Nenhuma conta TikTok conectada.</p>
          <a href={connectHref} className="ig-btn inline-flex items-center gap-2 px-4 py-2 text-sm">
            <Plus size={16} />
            Conectar TikTok
          </a>
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        {accounts.map((account) => {
          const label = account.username
            ? `@${account.username}`
            : account.display_name ?? "Conta TikTok";
          const needsReconnect = account.status === "error" || account.token_valid === false;
          const reconnectHref = `/api/auth/tiktok?next=/dashboard/tiktok&add_account=1`;

          return (
            <article
              key={account.id}
              className="rounded-xl border border-ig-border bg-ig-elevated p-5 shadow-sm"
            >
              <div className="flex items-start gap-4">
                {account.profile_picture_url ? (
                  <img
                    src={account.profile_picture_url}
                    alt={label}
                    className="h-14 w-14 rounded-full border border-ig-border object-cover"
                  />
                ) : (
                  <div className="flex h-14 w-14 items-center justify-center rounded-full border border-ig-border bg-ig-secondary text-sm font-bold text-ig-text">
                    TT
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-lg font-semibold text-ig-text">{label}</p>
                  <p className="text-xs text-ig-muted">TikTok · {account.open_id}</p>
                  <p className="mt-1 text-xs text-ig-muted">
                    Conectada em {formatDateTime(account.created_at)}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2 text-xs">
                    <span
                      className={`rounded-full px-2 py-0.5 ${
                        needsReconnect
                          ? "bg-ig-danger/10 text-ig-danger"
                          : "bg-emerald-500/10 text-emerald-700"
                      }`}
                    >
                      {needsReconnect ? "Reconexão necessária" : "Token OK"}
                    </span>
                    {account.publishing_paused && (
                      <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-amber-700">
                        Pausada
                      </span>
                    )}
                    {account.creator_max_duration_sec && (
                      <span className="rounded-full bg-ig-secondary px-2 py-0.5 text-ig-muted">
                        Máx. {account.creator_max_duration_sec}s
                      </span>
                    )}
                  </div>
                  {account.last_validation_error && (
                    <div className="mt-2 space-y-2">
                      <p className="text-xs text-ig-danger">{account.last_validation_error}</p>
                      <button
                        type="button"
                        onClick={() => void handleValidate(account.id)}
                        disabled={validatingId === account.id}
                        className="inline-flex items-center gap-1 rounded-lg bg-ig-primary px-3 py-1.5 text-xs font-medium text-ig-on-primary disabled:opacity-50"
                      >
                        <ShieldCheck size={14} />
                        {validatingId === account.id ? "Validando…" : "Validar novamente"}
                      </button>
                    </div>
                  )}
                </div>
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                {!compact && (
                  <a
                    href={`/dashboard/bulk?platform=tiktok&account=${account.id}`}
                    className="rounded-lg border border-ig-border bg-ig-secondary px-3 py-1.5 text-xs text-ig-text hover:bg-ig-surface"
                  >
                    Agendar vídeos
                  </a>
                )}
                <Link
                  href={`/dashboard/accounts/${account.id}/diagnostics?platform=tiktok`}
                  className="rounded-lg border border-ig-border bg-ig-secondary px-3 py-1.5 text-xs text-ig-text hover:bg-ig-surface"
                >
                  Diagnóstico
                </Link>
                {!account.last_validation_error && (
                  <button
                    type="button"
                    onClick={() => void handleValidate(account.id)}
                    disabled={validatingId === account.id}
                    className="inline-flex items-center gap-1 rounded-lg border border-ig-border bg-ig-secondary px-3 py-1.5 text-xs text-ig-text hover:bg-ig-surface disabled:opacity-50"
                  >
                    <ShieldCheck size={14} />
                    {validatingId === account.id ? "Validando…" : "Validar"}
                  </button>
                )}
                <a
                  href={reconnectHref}
                  className="inline-flex items-center gap-1 rounded-lg border border-ig-border bg-ig-secondary px-3 py-1.5 text-xs text-ig-text hover:bg-ig-surface"
                >
                  <RefreshCw size={14} />
                  Reconectar
                </a>
                {!compact && (
                  <button
                    type="button"
                    onClick={() => void handleDisconnect(account.id, label)}
                    disabled={removingId === account.id}
                    className="ml-auto flex items-center gap-1 rounded-lg border border-red-500/20 bg-ig-danger/10 px-3 py-1.5 text-xs text-ig-danger hover:bg-red-500/20 disabled:opacity-50"
                  >
                    <Trash2 size={14} />
                    {removingId === account.id ? "Desconectando…" : "Desconectar"}
                  </button>
                )}
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}
