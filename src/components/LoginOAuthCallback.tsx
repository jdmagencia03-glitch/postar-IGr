"use client";

import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { BrandLogo } from "@/components/BrandLogo";

const ERROR_MESSAGES: Record<string, string> = {
  oauth_invalid: "Falha na autenticação. Tente novamente.",
  session_required: "Faça login para continuar.",
  no_instagram:
    "Nenhuma conta Instagram Business/Creator vinculada a uma Página do Facebook.",
};

const EXCHANGE_TIMEOUT_MS = 55_000;

async function postExchange(
  body: { code: string; state: string; next: string },
  signal: AbortSignal,
) {
  const res = await fetch("/api/auth/meta/exchange", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    cache: "no-store",
    signal,
    body: JSON.stringify(body),
  });

  const text = await res.text();
  let data: {
    ok?: boolean;
    redirectTo?: string;
    error?: string;
    sessionCreated?: boolean;
  } = {};

  try {
    data = JSON.parse(text) as typeof data;
  } catch {
    throw new Error("invalid_response");
  }

  return { res, data };
}

export function LoginOAuthCallback() {
  const searchParams = useSearchParams();
  const started = useRef(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    const code = searchParams.get("code");
    const state = searchParams.get("state");
    const next =
      searchParams.get("next")?.startsWith("/") && !searchParams.get("next")?.startsWith("//")
        ? searchParams.get("next")!
        : "/dashboard";

    if (!code || !state) {
      setError("oauth_invalid");
      return;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), EXCHANGE_TIMEOUT_MS);

    (async () => {
      const payload = { code, state, next };

      try {
        let lastError = "Não foi possível conectar ao Instagram agora. Tente novamente.";

        for (let attempt = 0; attempt < 2; attempt++) {
          if (attempt > 0) {
            await new Promise((resolve) => setTimeout(resolve, 1_500));
          }

          try {
            const { res, data } = await postExchange(payload, controller.signal);

            if (!res.ok || !data.ok) {
              lastError = data.error ?? "Falha na autenticação. Tente novamente.";
              if (res.status >= 500 && attempt === 0) continue;
              setError(lastError);
              return;
            }

            const target = data.redirectTo?.startsWith("/")
              ? data.redirectTo
              : `${next}?connected=1`;
            window.location.replace(target);
            return;
          } catch (inner) {
            if (inner instanceof Error && inner.message === "invalid_response") {
              lastError = "Resposta inválida do servidor. Tente novamente.";
              if (attempt === 0) continue;
            }
            if (controller.signal.aborted) {
              setError("Instagram demorou para responder. Tente novamente.");
              return;
            }
            if (attempt === 0) continue;
            setError(lastError);
            return;
          }
        }

        setError(lastError);
      } catch {
        setError("Não foi possível conectar ao Instagram agora. Tente novamente.");
      } finally {
        clearTimeout(timer);
      }
    })();
  }, [searchParams]);

  if (error) {
    const label = ERROR_MESSAGES[error] ?? error;
    return (
      <div className="w-full max-w-md rounded-2xl border border-ig-border bg-ig-elevated p-8 text-center shadow-sm">
        <h1 className="mb-4">
          <BrandLogo />
        </h1>
        <p className="ig-alert-danger mb-6 p-4 text-sm">{label}</p>
        <a href="/login" className="ig-btn inline-block px-6 py-2.5">
          Voltar ao login
        </a>
      </div>
    );
  }

  return (
    <div className="w-full max-w-md rounded-2xl border border-ig-border bg-ig-elevated p-8 text-center shadow-sm">
      <h1 className="mb-4">
        <BrandLogo />
      </h1>
      <p className="text-sm text-ig-muted">Conectando sua conta Instagram…</p>
      <p className="mt-2 text-xs text-ig-muted">Isso pode levar alguns segundos.</p>
    </div>
  );
}
