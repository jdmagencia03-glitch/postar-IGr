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
    <div className="mb-8 rounded-2xl border border-white/10 bg-white/5 p-5">
      <p className="mb-4 text-sm font-medium text-zinc-300">Comece em 2 passos</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <a
          href="/dashboard/ai"
          className={`flex items-start gap-3 rounded-xl border px-4 py-3 transition ${
            activeStep === 1
              ? "border-pink-500/40 bg-pink-500/10"
              : step1Done
                ? "border-emerald-500/30 bg-emerald-500/5"
                : "border-white/10 bg-black/20 hover:bg-white/5"
          }`}
        >
          <div
            className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${
              step1Done ? "bg-emerald-500/20 text-emerald-300" : "bg-pink-500/20 text-pink-300"
            }`}
          >
            {step1Done ? <Check size={16} /> : <Brain size={16} />}
          </div>
          <div>
            <p className="text-sm font-semibold text-white">
              1. Treinar IA
              {step1Done && <span className="ml-2 text-xs font-normal text-emerald-300">Pronto</span>}
            </p>
            <p className="mt-1 text-xs text-zinc-400">
              Configure tom, ganchos e hashtags uma vez. A IA usa isso em todos os vídeos.
            </p>
          </div>
        </a>

        <a
          href="/dashboard/bulk"
          className={`flex items-start gap-3 rounded-xl border px-4 py-3 transition ${
            activeStep === 2
              ? "border-pink-500/40 bg-pink-500/10"
              : step2Done
                ? "border-emerald-500/30 bg-emerald-500/5"
                : "border-white/10 bg-black/20 hover:bg-white/5"
          }`}
        >
          <div
            className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${
              step2Done ? "bg-emerald-500/20 text-emerald-300" : "bg-pink-500/20 text-pink-300"
            }`}
          >
            {step2Done ? <Check size={16} /> : <Upload size={16} />}
          </div>
          <div>
            <p className="text-sm font-semibold text-white">
              2. Enviar vídeos
              {step2Done && <span className="ml-2 text-xs font-normal text-emerald-300">Feito</span>}
            </p>
            <p className="mt-1 text-xs text-zinc-400">
              Arraste seus Reels prontos. A IA programa legendas e horários automaticamente.
            </p>
          </div>
        </a>
      </div>
      {!playbookReady && (
        <p className="mt-3 text-xs text-amber-300">
          Dica: treine a IA primeiro para legendas mais personalizadas. Sem playbook, usamos legendas
          automáticas.
        </p>
      )}
    </div>
  );
}
