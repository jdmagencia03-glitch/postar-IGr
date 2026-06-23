"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertCircle } from "lucide-react";
import { fetchWithTimeout } from "@/lib/client-fetch-timeout";

const CHECK_TIMEOUT_MS = 10_000;
const RETRY_MS = 60_000;

function isDegradedApiError(json: unknown): boolean {
  if (!json || typeof json !== "object") return false;
  const error = (json as { error?: string }).error;
  return error === "auth_timeout" || error === "auth_db_error" || error === "db_timeout";
}

/** Banner local quando auth ou banco estão lentos — sem redirecionar para login. */
export function ApiStabilityBanner() {
  const [message, setMessage] = useState<string | null>(null);
  const degradedStreakRef = useRef(0);

  const check = useCallback(async () => {
    try {
      const [authRes, accountsRes] = await Promise.all([
        fetchWithTimeout("/api/debug/auth-state", { credentials: "include", cache: "no-store" }, CHECK_TIMEOUT_MS),
        fetchWithTimeout("/api/accounts", { credentials: "include", cache: "no-store" }, CHECK_TIMEOUT_MS),
      ]);

      const authJson = authRes.ok ? await authRes.json().catch(() => null) : null;
      const accountsJson = await accountsRes.json().catch(() => null);

      const authDegraded =
        authJson &&
        (authJson.sessionLookup === "auth_timeout" || authJson.sessionLookup === "auth_db_error");

      const accountsDegraded = accountsRes.status === 503 && isDegradedApiError(accountsJson);

      if (authDegraded || accountsDegraded) {
        degradedStreakRef.current += 1;
      } else {
        degradedStreakRef.current = 0;
      }

      // Evita alarme falso em uma oscilação rápida.
      if (degradedStreakRef.current < 2) {
        setMessage(null);
        return;
      }

      if (authDegraded) {
        setMessage(
          "Não foi possível validar sua sessão agora. Alguns dados podem estar indisponíveis — tente novamente em instantes.",
        );
        return;
      }

      if (accountsDegraded) {
        setMessage("O banco está temporariamente lento. Alguns dados podem demorar para carregar.");
        return;
      }

      setMessage(null);
    } catch {
      degradedStreakRef.current += 1;
      if (degradedStreakRef.current >= 2) {
        setMessage("Servidor demorou para responder. Tentando novamente em instantes.");
      }
    }
  }, []);

  useEffect(() => {
    check();
    const interval = setInterval(check, RETRY_MS);
    return () => clearInterval(interval);
  }, [check]);

  if (!message) return null;

  return (
    <div className="border-b border-amber-500/30 bg-amber-500/10 px-4 py-2.5 text-sm text-amber-200">
      <div className="mx-auto flex max-w-6xl items-center gap-2">
        <AlertCircle size={16} className="shrink-0" />
        <span>{message}</span>
      </div>
    </div>
  );
}
