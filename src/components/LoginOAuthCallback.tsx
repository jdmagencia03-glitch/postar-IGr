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

/** Fallback: redireciona para finish via navegação completa (compatível com AdsPower). */
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

    const finishUrl = new URL("/api/auth/meta/finish", window.location.origin);
    finishUrl.searchParams.set("code", code);
    finishUrl.searchParams.set("state", state);
    finishUrl.searchParams.set("next", next);
    window.location.replace(finishUrl.toString());
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
