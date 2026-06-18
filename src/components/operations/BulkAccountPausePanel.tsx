"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pause, Play } from "lucide-react";
import type { AccountOperationsSummary } from "@/lib/operations/account-ops";

interface Props {
  accounts: AccountOperationsSummary[];
}

export function BulkAccountPausePanel({ accounts }: Props) {
  const router = useRouter();
  const [selected, setSelected] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  function toggle(id: string) {
    setSelected((current) =>
      current.includes(id) ? current.filter((x) => x !== id) : [...current, id],
    );
  }

  async function apply(paused: boolean) {
    if (!selected.length) return;
    const confirmed = window.confirm(
      paused
        ? `Pausar publicações de ${selected.length} conta(s)? Os posts continuarão salvos.`
        : `Retomar publicações de ${selected.length} conta(s)?`,
    );
    if (!confirmed) return;

    setLoading(true);
    setMessage(null);
    try {
      const payload = {
        paused,
        accounts: selected.map((id) => {
          const account = accounts.find((a) => a.id === id)!;
          return { id, platform: account.platform };
        }),
      };
      const res = await fetch("/api/operations/accounts/bulk-pause", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(String(data.error ?? "Falha"));
      setMessage(String(data.message));
      setSelected([]);
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Erro");
    } finally {
      setLoading(false);
    }
  }

  if (accounts.length < 2) return null;

  return (
    <section className="rounded-2xl border border-ig-border bg-ig-elevated p-4">
      <h3 className="text-sm font-semibold text-ig-text">Pausa em massa</h3>
      <p className="mt-1 text-xs text-ig-muted">
        Selecione contas para pausar ou retomar publicações automáticas.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        {accounts.map((account) => (
          <label
            key={`${account.platform}-${account.id}`}
            className={`flex cursor-pointer items-center gap-2 rounded-full border px-3 py-1.5 text-xs ${
              selected.includes(account.id)
                ? "border-ig-primary bg-ig-primary/10"
                : "border-ig-border"
            }`}
          >
            <input
              type="checkbox"
              checked={selected.includes(account.id)}
              onChange={() => toggle(account.id)}
            />
            {account.platform === "tiktok" ? "TT" : "IG"} @{account.username ?? "conta"}
          </label>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={!selected.length || loading}
          onClick={() => void apply(true)}
          className="inline-flex items-center gap-1 rounded-lg border border-ig-border px-3 py-1.5 text-xs disabled:opacity-50"
        >
          <Pause className="h-3.5 w-3.5" /> Pausar selecionadas
        </button>
        <button
          type="button"
          disabled={!selected.length || loading}
          onClick={() => void apply(false)}
          className="inline-flex items-center gap-1 rounded-lg border border-ig-border px-3 py-1.5 text-xs disabled:opacity-50"
        >
          <Play className="h-3.5 w-3.5" /> Retomar selecionadas
        </button>
      </div>
      {message && <p className="mt-2 text-xs text-ig-muted">{message}</p>}
    </section>
  );
}
