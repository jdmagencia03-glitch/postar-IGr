"use client";

import Link from "next/link";
import { useEffect } from "react";

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[dashboard-error]", error);
  }, [error]);

  return (
    <div className="mx-auto flex max-w-lg flex-col items-center rounded-2xl border border-ig-border bg-ig-elevated p-8 text-center">
      <h2 className="text-lg font-semibold text-ig-text">Não foi possível carregar esta página</h2>
      <p className="mt-2 text-sm text-ig-muted">
        Os dados demoraram ou falharam ao carregar. Tente novamente ou volte ao início.
      </p>
      <div className="mt-5 flex flex-wrap justify-center gap-2">
        <button
          type="button"
          onClick={() => reset()}
          className="rounded-lg bg-ig-primary px-4 py-2 text-sm font-medium text-ig-on-primary"
        >
          Tentar novamente
        </button>
        <Link
          href="/dashboard"
          className="rounded-lg border border-ig-border px-4 py-2 text-sm font-medium text-ig-text hover:bg-ig-secondary"
        >
          Ir ao início
        </Link>
      </div>
    </div>
  );
}
