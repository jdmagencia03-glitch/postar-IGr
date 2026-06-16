"use client";

import { Brain, Check, Upload } from "lucide-react";

interface Props {
  playbookReady: boolean;
  hasScheduledPosts?: boolean;
  currentStep?: 1 | 2;
}

export function OnboardingSteps({ playbookReady, hasScheduledPosts, currentStep }: Props) {
  const step1Done = playbookReady;
  const step2Done = Boolean(hasScheduledPosts);
  const activeStep = currentStep ?? (step1Done ? 2 : 1);

  return (
    <div className="mb-8 ig-panel p-5">
      <p className="mb-4 text-sm font-medium text-ig-text">Comece em 2 passos</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <a
          href="/dashboard/ai"
          className={`flex items-start gap-3 rounded-xl border px-4 py-3 transition ${
            activeStep === 1
              ? "border-ig-info-border bg-ig-info-bg"
              : step1Done
                ? "border-ig-border bg-ig-elevated"
                : "border-ig-border bg-ig-elevated hover:bg-ig-secondary"
          }`}
        >
          <div
            className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${
              step1Done ? "bg-ig-secondary text-ig-text" : "bg-ig-info-bg text-ig-info-text"
            }`}
          >
            {step1Done ? <Check size={16} /> : <Brain size={16} />}
          </div>
          <div>
            <p className="text-sm font-semibold text-ig-text">
              1. Configurar estilo
              {step1Done && <span className="ml-2 text-xs font-normal text-ig-text">Pronto</span>}
            </p>
            <p className="mt-1 text-xs text-ig-muted">
              Defina tom, exemplos e objetivo da página. A IA usa isso em todos os vídeos.
            </p>
          </div>
        </a>

        <a
          href="/dashboard/bulk"
          className={`flex items-start gap-3 rounded-xl border px-4 py-3 transition ${
            activeStep === 2
              ? "border-ig-info-border bg-ig-info-bg"
              : step2Done
                ? "border-ig-border bg-ig-elevated"
                : "border-ig-border bg-ig-elevated hover:bg-ig-secondary"
          }`}
        >
          <div
            className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${
              step2Done ? "bg-ig-secondary text-ig-text" : "bg-ig-info-bg text-ig-info-text"
            }`}
          >
            {step2Done ? <Check size={16} /> : <Upload size={16} />}
          </div>
          <div>
            <p className="text-sm font-semibold text-ig-text">
              2. Enviar vídeos
              {step2Done && <span className="ml-2 text-xs font-normal text-ig-text">Feito</span>}
            </p>
            <p className="mt-1 text-xs text-ig-muted">
              Arraste seus Reels prontos. A IA programa legendas e horários automaticamente.
            </p>
          </div>
        </a>
      </div>
      {!playbookReady && (
        <p className="mt-3 text-xs text-ig-muted">
          Dica: configure o estilo da página primeiro para legendas mais personalizadas. Sem isso,
          usamos legendas automáticas.
        </p>
      )}
    </div>
  );
}
