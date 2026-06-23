"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { BrandLogo } from "@/components/BrandLogo";

const ERROR_MESSAGES: Record<string, string> = {
  oauth_invalid: "Falha na autenticação. Tente novamente.",
  session_required: "Faça login para continuar.",
  no_instagram:
    "Nenhuma conta Instagram Business/Creator vinculada a uma Página do Facebook.",
};

async function waitForSession(maxMs = 8_000): Promise<boolean> {
  const started = Date.now();
  while (Date.now() - started < maxMs) {
    try {
      const res = await fetch("/api/auth/session", {
        credentials: "include",
        cache: "no-store",
      });
      if (res.ok) {
        const data = (await res.json()) as { authenticated?: boolean };
        if (data.authenticated === true) return true;
      }
    } catch {
      // retry
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return false;
}

export function LoginOAuthCallback() {
  const router = useRouter();
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
    const timer = setTimeout(() => controller.abort(), 30_000);

    (async () => {
      try {
        const res = await fetch("/api/auth/meta/exchange", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          cache: "no-store",
          signal: controller.signal,
          body: JSON.stringify({ code, state, next }),
        });

        const data = (await res.json()) as {
          ok?: boolean;
          redirectTo?: string;
          error?: string;
          sessionCreated?: boolean;
        };

        if (!res.ok || !data.ok) {
          setError(data.error ?? "Falha na autenticação. Tente novamente.");
          return;
        }

        const sessionOk = await waitForSession();
        if (!sessionOk) {
          setError("Não foi possível iniciar sua sessão. Tente novamente.");
          return;
        }

        const target = data.redirectTo?.startsWith("/")
          ? data.redirectTo
          : `${next}?connected=1`;
        router.replace(target);
      } catch {
        setError("Não foi possível conectar ao Instagram agora. Tente novamente.");
      } finally {
        clearTimeout(timer);
      }
    })();
  }, [router, searchParams]);

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
