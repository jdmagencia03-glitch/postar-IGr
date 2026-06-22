"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Redireciona sessão ativa sem bloquear o render da home no servidor. */
export function HomeSessionRedirect() {
  const router = useRouter();

  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2_000);

    fetch("/api/auth/session", { credentials: "include", cache: "no-store", signal: controller.signal })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.authenticated) router.replace("/dashboard");
      })
      .catch(() => undefined)
      .finally(() => clearTimeout(timer));

    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [router]);

  return null;
}
