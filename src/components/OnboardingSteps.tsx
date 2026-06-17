"use client";

import { Check, ChevronRight, Palette, Upload } from "lucide-react";

interface Props {
  playbookReady: boolean;
  hasScheduledPosts?: boolean;
  currentStep?: 1 | 2;
}

export function OnboardingSteps({ playbookReady, hasScheduledPosts, currentStep }: Props) {
  const step1Done = playbookReady;
  const step2Done = Boolean(hasScheduledPosts);
  const activeStep = currentStep ?? (step1Done ? 2 : 1);

  const steps = [
    {
      href: "/dashboard/ai",
      number: 1,
      title: "Configurar estilo",
      description: "Defina tom, exemplos e chaves da marca.",
      done: step1Done,
      active: activeStep === 1,
      icon: Palette,
    },
    {
      href: "/dashboard/bulk",
      number: 2,
      title: "Enviar vídeos",
      description: "Arraste seus vídeos prontos e agende para Instagram e TikTok.",
      done: step2Done,
      active: activeStep === 2,
      icon: Upload,
    },
  ] as const;

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold text-ig-text">Comece em 2 passos</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        {steps.map((step) => {
          const Icon = step.icon;
          return (
            <a
              key={step.href}
              href={step.href}
              className={`group flex items-center gap-4 rounded-2xl border px-4 py-4 transition ${
                step.active
                  ? "border-ig-info-border bg-ig-info-bg/60"
                  : "border-ig-border bg-ig-elevated hover:border-ig-primary/30 hover:bg-ig-secondary/50"
              }`}
            >
              <div
                className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${
                  step.done
                    ? "bg-ig-success/15 text-ig-success"
                    : step.active
                      ? "bg-ig-primary text-ig-on-primary"
                      : "bg-ig-info-bg text-ig-info-text"
                }`}
              >
                {step.done ? <Check size={18} /> : step.number}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <Icon size={16} className="shrink-0 text-ig-primary" strokeWidth={1.75} />
                  <p className="text-sm font-semibold text-ig-text">{step.title}</p>
                </div>
                <p className="mt-0.5 text-xs leading-relaxed text-ig-muted">{step.description}</p>
              </div>
              <ChevronRight
                size={18}
                className="shrink-0 text-ig-muted transition group-hover:translate-x-0.5 group-hover:text-ig-primary"
              />
            </a>
          );
        })}
      </div>
    </section>
  );
}
