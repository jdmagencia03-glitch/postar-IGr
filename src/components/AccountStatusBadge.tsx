"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertCircle, CheckCircle2 } from "lucide-react";

type AccountStatus = "active" | "error" | "loading";

interface HealthResponse {
  account_status: "active" | "error";
  status_message: string;
  username?: string | null;
}

export function AccountStatusBadge() {
  const [status, setStatus] = useState<AccountStatus>("loading");
  const [message, setMessage] = useState("Verificando conta...");
  const [accountCount, setAccountCount] = useState(0);

  const fetchHealth = useCallback(async () => {
    try {
      const [healthRes, igAccountsRes, tiktokAccountsRes] = await Promise.all([
        fetch("/api/instagram/health", { credentials: "include", cache: "no-store" }),
        fetch("/api/accounts", { credentials: "include", cache: "no-store" }),
        fetch("/api/tiktok/accounts", { credentials: "include", cache: "no-store" }),
      ]);

      const igAccounts = igAccountsRes.ok ? await igAccountsRes.json() : [];
      const tiktokAccounts = tiktokAccountsRes.ok ? await tiktokAccountsRes.json() : [];
      const igCount = Array.isArray(igAccounts) ? igAccounts.length : 0;
      const tiktokCount = Array.isArray(tiktokAccounts) ? tiktokAccounts.length : 0;
      const totalCount = igCount + tiktokCount;

      setAccountCount(totalCount);

      if (tiktokCount > 0 && igCount === 0) {
        setStatus("active");
        setMessage(
          tiktokCount === 1
            ? "Conta TikTok conectada"
            : `${tiktokCount} contas TikTok conectadas`,
        );
        return;
      }

      const health = healthRes.ok
        ? ((await healthRes.json()) as HealthResponse)
        : null;
      const igActive = health?.account_status === "active";
      const tiktokActive = tiktokCount > 0;

      if (igCount > 0 && tiktokCount > 0) {
        setStatus(igActive || tiktokActive ? "active" : "error");
        if (igActive && tiktokActive) {
          setMessage(`${igCount} IG · ${tiktokCount} TikTok conectadas`);
        } else if (igActive) {
          setMessage(health?.status_message ?? "Instagram ativo · TikTok indisponível");
        } else if (tiktokActive) {
          setMessage("TikTok ativo · Instagram indisponível");
        } else {
          setMessage(health?.status_message ?? "Contas indisponíveis");
        }
        return;
      }

      if (igCount > 0) {
        if (!healthRes.ok || !health) {
          setStatus("error");
          setMessage("Falha ao verificar conta Instagram");
          return;
        }
        setStatus(health.account_status);
        setMessage(health.status_message);
        return;
      }

      setStatus("error");
      setMessage("Nenhuma conta conectada");
    } catch {
      setStatus("error");
      setMessage("Contas indisponíveis no momento");
    }
  }, []);

  useEffect(() => {
    fetchHealth();
    const interval = setInterval(fetchHealth, 60_000);
    return () => clearInterval(interval);
  }, [fetchHealth]);

  if (status === "loading") {
    return (
      <span
        title="Verificando conta..."
        className="hidden items-center gap-1.5 rounded-full border border-ig-border bg-ig-secondary px-2.5 py-1 text-xs text-ig-muted sm:flex"
      >
        <span className="h-2 w-2 animate-pulse rounded-full bg-ig-muted" />
        ...
      </span>
    );
  }

  const isActive = status === "active";

  return (
    <a
      href="/dashboard/accounts"
      title={`${message}${accountCount > 0 ? ` · ${accountCount} conta(s)` : ""}`}
      className={`hidden items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium sm:flex ${
        isActive
          ? "border-ig-border bg-ig-elevated text-ig-text"
          : "border-ig-danger/30 bg-ig-danger/10 text-ig-danger"
      }`}
    >
      {isActive ? <CheckCircle2 size={12} /> : <AlertCircle size={12} />}
      <span className="h-2 w-2 rounded-full bg-current" />
      {isActive ? "Ativo" : "Erro"}
      {accountCount > 1 && <span className="text-[10px] opacity-80">({accountCount})</span>}
    </a>
  );
}
