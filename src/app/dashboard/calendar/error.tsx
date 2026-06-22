"use client";

import Link from "next/link";

export default function CalendarError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="mx-auto max-w-lg rounded-2xl border border-ig-border bg-ig-elevated p-6 text-center">
      <h2 className="text-lg font-semibold text-ig-text">Não foi possível carregar o calendário</h2>
      <p className="mt-2 text-sm text-ig-muted">
        {error.message || "Ocorreu um erro ao buscar os posts deste mês."}
      </p>
      <div className="mt-5 flex flex-wrap justify-center gap-2">
        <button
          type="button"
          onClick={() => reset()}
          className="rounded-lg border border-ig-border px-4 py-2 text-sm font-medium text-ig-text hover:bg-ig-secondary"
        >
          Tentar novamente
        </button>
        <Link
          href="/dashboard/calendar?view=pending"
          className="rounded-lg bg-ig-primary px-4 py-2 text-sm font-medium text-ig-on-primary"
        >
          Ver pendentes
        </Link>
        <Link
          href="/dashboard/calendar"
          className="rounded-lg border border-ig-border px-4 py-2 text-sm text-ig-text hover:bg-ig-secondary"
        >
          Voltar ao calendário
        </Link>
      </div>
    </div>
  );
}
