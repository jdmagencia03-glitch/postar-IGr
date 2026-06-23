"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Redireciona sessão ativa sem bloquear o SSR da página de login. */
export function LoginSessionRedirect({ nextPath }: { nextPath: string }) {
  const router = useRouter();

  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8_000);

    fetch("/api/auth/session", { credentials: "include", cache: "no-store", signal: controller.signal })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.authenticated === true) router.replace(nextPath);
      })
      .catch(() => undefined)
      .finally(() => clearTimeout(timer));

    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [router, nextPath]);

  return null;
}
