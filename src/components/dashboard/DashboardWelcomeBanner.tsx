import { Check, Users } from "lucide-react";
import { APP_NAME } from "@/lib/brand";

export function DashboardWelcomeBanner() {
  return (
    <section className="ig-hero relative overflow-hidden p-6 sm:p-8">
      <div className="relative z-10 grid gap-6 lg:grid-cols-[1fr_auto] lg:items-center">
        <div className="max-w-xl space-y-4">
          <p className="text-sm font-medium text-ig-primary">
            Bem-vindo ao {APP_NAME}! 👋
          </p>
          <h1 className="text-2xl font-normal leading-snug text-ig-text sm:text-[1.75rem]">
            Organize, agende e publique seu conteúdo com inteligência.
          </h1>
          <p className="text-sm leading-relaxed text-ig-muted">
            Automatize seu fluxo de trabalho e foque no que realmente importa: criar conteúdo
            que engaja.
          </p>
          <div className="flex flex-wrap gap-2 pt-1">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-ig-border bg-ig-secondary px-3 py-1 text-xs font-medium text-ig-text">
              <Check size={12} className="text-ig-primary" />
              Simples de usar
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-ig-border bg-ig-secondary px-3 py-1 text-xs font-medium text-ig-text">
              <Users size={12} className="text-ig-primary" />
              Feito para criadores e agências
            </span>
          </div>
        </div>

        <div className="hidden shrink-0 lg:block" aria-hidden>
          <DashboardHeroIllustration />
        </div>
      </div>
    </section>
  );
}

function DashboardHeroIllustration() {
  return (
    <div className="relative h-36 w-56">
      <div className="absolute right-0 top-2 flex h-24 w-32 flex-col items-center justify-center rounded-2xl border border-ig-border bg-ig-info-bg shadow-sm">
        <div className="mb-1 h-8 w-10 rounded-md border-2 border-ig-primary/40 bg-ig-elevated" />
        <div className="h-1.5 w-12 rounded-full bg-ig-primary/30" />
        <div className="mt-2 text-[10px] font-semibold text-ig-primary">↑ upload</div>
      </div>
      <div className="absolute bottom-0 left-0 flex h-20 w-24 flex-col rounded-xl border border-ig-border bg-ig-elevated p-2 shadow-sm">
        <div className="grid grid-cols-7 gap-0.5">
          {Array.from({ length: 14 }).map((_, i) => (
            <div
              key={i}
              className={`h-1.5 w-1.5 rounded-sm ${i === 9 ? "bg-ig-primary" : "bg-ig-border"}`}
            />
          ))}
        </div>
        <div className="mt-auto flex justify-center">
          <div className="flex h-4 w-4 items-center justify-center rounded-full bg-ig-success/20 text-[8px] text-ig-success">
            ✓
          </div>
        </div>
      </div>
      <div className="absolute bottom-6 right-8 flex gap-1.5">
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-ig-secondary text-xs">
          📷
        </span>
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-ig-secondary text-xs">
          🎵
        </span>
      </div>
    </div>
  );
}
