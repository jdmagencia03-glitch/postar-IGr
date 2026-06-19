"use client";

import {
  SCHEDULE_STRATEGY_LABELS,
  type ScheduleInsertionStrategy,
} from "@/lib/schedule-insertion";

interface Props {
  value: ScheduleInsertionStrategy;
  onChange: (strategy: ScheduleInsertionStrategy) => void;
  onConfirm: () => void;
  onCancel: () => void;
  loading?: boolean;
}

const STRATEGY_ORDER: ScheduleInsertionStrategy[] = ["continue", "new_plan", "fill_gaps"];

export function ScheduleStrategyPicker({
  value,
  onChange,
  onConfirm,
  onCancel,
  loading,
}: Props) {
  return (
    <div className="ig-overlay fixed inset-0 z-50 flex items-end justify-center p-4 sm:items-center">
      <div className="ig-card w-full max-w-lg shadow-2xl">
        <div className="border-b border-ig-border px-5 py-4">
          <h2 className="text-lg font-semibold text-ig-text">Como deseja encaixar estes vídeos?</h2>
          <p className="mt-1 text-sm text-ig-muted">
            Esta conta já tem posts agendados. Escolha como distribuir os novos vídeos no calendário.
          </p>
        </div>

        <div className="space-y-2 px-5 py-4">
          {STRATEGY_ORDER.map((strategy) => {
            const option = SCHEDULE_STRATEGY_LABELS[strategy];
            const selected = value === strategy;
            return (
              <button
                key={strategy}
                type="button"
                onClick={() => onChange(strategy)}
                disabled={loading}
                className={`w-full rounded-xl border px-4 py-3 text-left transition ${
                  selected
                    ? "border-ig-primary bg-ig-primary/10"
                    : "border-ig-border bg-ig-secondary hover:border-ig-primary/40"
                }`}
              >
                <p className="text-sm font-semibold text-ig-text">
                  {option.title}
                  {strategy === "continue" ? " (recomendado)" : ""}
                </p>
                <p className="mt-1 text-xs text-ig-muted">{option.description}</p>
              </button>
            );
          })}
        </div>

        <div className="flex flex-col gap-2 border-t border-ig-border px-5 py-4 sm:flex-row">
          <button
            type="button"
            onClick={onCancel}
            disabled={loading}
            className="flex-1 rounded-lg border border-ig-border bg-ig-secondary px-4 py-3 text-sm text-ig-text hover:bg-ig-secondary disabled:opacity-50"
          >
            Voltar
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={loading}
            className="flex-1 ig-btn px-4 py-3 text-sm disabled:opacity-50"
          >
            {loading ? "Gerando prévia..." : "Continuar para prévia"}
          </button>
        </div>
      </div>
    </div>
  );
}
