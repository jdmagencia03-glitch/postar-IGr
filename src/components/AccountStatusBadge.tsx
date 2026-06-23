"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertCircle, CheckCircle2, ChevronDown } from "lucide-react";
import { fetchWithTimeout, parseAccountsListPayload } from "@/lib/client-fetch-timeout";

type AccountStatus = "active" | "error" | "loading";

interface HealthResponse {
  account_status: "active" | "error";
  status_message: string;
  username?: string | null;
}

const FETCH_TIMEOUT_MS = 8_000;

export function AccountStatusBadge({ showAvatar = false }: { showAvatar?: boolean }) {
  const [status, setStatus] = useState<AccountStatus>("loading");
  const [message, setMessage] = useState("Verificando conta...");
  const [accountCount, setAccountCount] = useState(0);

  const fetchHealth = useCallback(async () => {
    try {
      const [igAccountsRes, tiktokAccountsRes] = await Promise.all([
        fetchWithTimeout("/api/accounts", { credentials: "include", cache: "no-store" }, FETCH_TIMEOUT_MS),
        fetchWithTimeout("/api/tiktok/accounts", { credentials: "include", cache: "no-store" }, FETCH_TIMEOUT_MS),
      ]);

      const igAccountsJson = await igAccountsRes.json().catch(() => []);
      const tiktokAccountsJson = tiktokAccountsRes.ok ? await tiktokAccountsRes.json() : [];
      const igAccounts = parseAccountsListPayload(igAccountsJson);
      const tiktokAccounts = parseAccountsListPayload(tiktokAccountsJson);
      const igCount = igAccounts.length;
      const tiktokCount = tiktokAccounts.length;
      const totalCount = igCount + tiktokCount;

      const apiDegraded =
        igAccountsRes.status === 503 &&
        igAccountsJson &&
        typeof igAccountsJson === "object" &&
        "error" in igAccountsJson &&
        ["auth_timeout", "auth_db_error", "db_timeout"].includes(
          (igAccountsJson as { error?: string }).error ?? "",
        );

      const dbSlow =
        apiDegraded ||
        (igAccountsJson &&
          typeof igAccountsJson === "object" &&
          "error" in igAccountsJson &&
          (igAccountsJson as { error?: string }).error === "db_timeout");

      if (dbSlow && totalCount === 0) {
        setStatus("error");
        setMessage(
          apiDegraded ? "Sessão ou banco indisponível no momento" : "Contas indisponíveis no momento",
        );
        return;
      }

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

      if (igCount === 0 && tiktokCount === 0) {
        setStatus("error");
        setMessage("Nenhuma conta conectada");
        return;
      }

      if (igCount > 0) {
        const healthRes = await fetchWithTimeout(
          "/api/instagram/health",
          { credentials: "include", cache: "no-store" },
          FETCH_TIMEOUT_MS,
        );
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

        if (!healthRes.ok || !health) {
          setStatus(totalCount > 0 ? "active" : "error");
          setMessage(
            totalCount > 0
              ? `${igCount} conta(s) Instagram conectada(s)`
              : "Falha ao verificar conta Instagram",
          );
          return;
        }
        setStatus(health.account_status);
        setMessage(health.status_message);
        return;
      }

      setStatus("active");
      setMessage(`${tiktokCount} conta(s) TikTok conectada(s)`);
    } catch {
      setStatus("error");
      setMessage("Contas indisponíveis no momento");
    }
  }, []);

  useEffect(() => {
    fetchHealth();
    const interval = setInterval(fetchHealth, 300_000);
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

  if (showAvatar) {
    return (
      <a
        href="/dashboard/accounts"
        title={message}
        className={`hidden items-center gap-2 rounded-full border py-1 pl-1 pr-2.5 text-xs font-medium sm:flex ${
          isActive
            ? "border-ig-border bg-ig-elevated text-ig-text"
            : "border-ig-danger/30 bg-ig-danger/10 text-ig-danger"
        }`}
      >
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-ig-primary text-xs font-semibold text-ig-on-primary">
          A
        </span>
        <span>{isActive ? "Ativo" : "Erro"}</span>
        <ChevronDown size={14} className="text-ig-muted" />
      </a>
    );
  }

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
