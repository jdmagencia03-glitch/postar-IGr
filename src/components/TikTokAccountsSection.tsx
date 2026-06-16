"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Music2, Plus, Trash2 } from "lucide-react";
import { formatDateTime } from "@/lib/utils";

export interface TikTokAccountItem {
  id: string;
  open_id: string;
  username: string | null;
  display_name: string | null;
  profile_picture_url: string | null;
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

  async function handleRemove(accountId: string, label: string) {
    if (!confirm(`Remover ${label}? Os posts TikTok agendados também serão apagados.`)) {
      return;
    }

    setRemovingId(accountId);
    setMessage(null);

    try {
      const res = await fetch(`/api/tiktok/accounts?id=${accountId}`, {
        method: "DELETE",
        credentials: "include",
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(String(data.error ?? "Falha ao remover conta"));
      }
      setMessage("Conta TikTok removida.");
      await fetchAccounts();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Erro ao remover conta");
    } finally {
      setRemovingId(null);
    }
  }

  return (
    <div className="space-y-4">
      {!compact && (
        <div className="rounded-lg border border-ig-border bg-ig-elevated px-4 py-3 text-xs text-ig-muted">
          <strong className="text-ig-text">App não auditado:</strong> até a aprovação do TikTok,
          publicações podem ficar privadas. Limite de ~25 vídeos/dia por conta.
        </div>
      )}

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
                </div>
              </div>

              {!compact && (
                <div className="mt-4 flex flex-wrap gap-2">
                  <a
                    href={`/dashboard/bulk?platform=tiktok&account=${account.id}`}
                    className="rounded-lg border border-ig-border bg-ig-secondary px-3 py-1.5 text-xs text-ig-text hover:bg-ig-surface"
                  >
                    Agendar vídeos
                  </a>
                  <button
                    type="button"
                    onClick={() => handleRemove(account.id, label)}
                    disabled={removingId === account.id}
                    className="ml-auto flex items-center gap-1 rounded-lg border border-red-500/20 bg-ig-danger/10 px-3 py-1.5 text-xs text-ig-danger hover:bg-red-500/20 disabled:opacity-50"
                  >
                    <Trash2 size={14} />
                    {removingId === account.id ? "Removendo..." : "Remover"}
                  </button>
                </div>
              )}
            </article>
          );
        })}
      </div>
    </div>
  );
}
