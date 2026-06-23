"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertCircle } from "lucide-react";
import { fetchWithTimeout } from "@/lib/client-fetch-timeout";

const CHECK_TIMEOUT_MS = 15_000;
const RETRY_IDLE_MS = 300_000;
const DEGRADED_STREAK_THRESHOLD = 3;

/** Banner local quando auth está lento — polling mínimo para não sobrecarregar o banco. */
export function ApiStabilityBanner() {
  const [message, setMessage] = useState<string | null>(null);
  const degradedStreakRef = useRef(0);

  const check = useCallback(async () => {
    try {
      const authRes = await fetchWithTimeout(
        "/api/debug/auth-state",
        { credentials: "include", cache: "no-store" },
        CHECK_TIMEOUT_MS,
      );

      const authJson = authRes.ok ? await authRes.json().catch(() => null) : null;

      const authDegraded =
        authJson &&
        (authJson.sessionLookup === "auth_timeout" || authJson.sessionLookup === "auth_db_error");

      if (authDegraded) {
        degradedStreakRef.current += 1;
      } else {
        degradedStreakRef.current = 0;
      }

      if (degradedStreakRef.current < DEGRADED_STREAK_THRESHOLD) {
        setMessage(null);
        return;
      }

      if (authDegraded) {
        setMessage(
          "Não foi possível validar sua sessão agora. Alguns dados podem estar indisponíveis — tente novamente em instantes.",
        );
        return;
      }

      setMessage(null);
    } catch {
      degradedStreakRef.current += 1;
      if (degradedStreakRef.current >= DEGRADED_STREAK_THRESHOLD) {
        setMessage("Servidor demorou para responder. Tentando novamente em instantes.");
      }
    }
  }, []);

  useEffect(() => {
    check();
    const interval = setInterval(check, RETRY_IDLE_MS);
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
