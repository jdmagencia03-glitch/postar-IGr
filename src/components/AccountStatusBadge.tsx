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
      const [healthRes, accountsRes] = await Promise.all([
        fetch("/api/instagram/health", { credentials: "include", cache: "no-store" }),
        fetch("/api/accounts", { credentials: "include", cache: "no-store" }),
      ]);

      const data = (await healthRes.json()) as HealthResponse;
      const accounts = accountsRes.ok ? await accountsRes.json() : [];

      if (!healthRes.ok) {
        setStatus("error");
        setMessage("Falha ao verificar conta");
        setAccountCount(Array.isArray(accounts) ? accounts.length : 0);
        return;
      }

      setStatus(data.account_status);
      setMessage(data.status_message);
      setAccountCount(Array.isArray(accounts) ? accounts.length : 0);
    } catch {
      setStatus("error");
      setMessage("Instagram indisponível no momento");
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
          ? "border-ig-success/30 bg-ig-success/10 text-ig-success"
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
