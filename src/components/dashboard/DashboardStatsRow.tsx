import { CheckCircle2, Inbox, XCircle } from "lucide-react";

interface Stats {
  pending: number;
  published: number;
  publishedLast7Days: number;
  failed: number;
}

export function DashboardStatsRow({ stats }: { stats: Stats }) {
  const cards = [
    {
      label: "Pendentes",
      value: stats.pending,
      sub:
        stats.pending === 0
          ? "Nenhum vídeo na fila"
          : stats.pending === 1
            ? "1 vídeo na fila"
            : `${stats.pending} vídeos na fila`,
      icon: Inbox,
      iconClass: "text-ig-primary bg-ig-info-bg",
      valueClass: "text-ig-text",
    },
    {
      label: "Publicados",
      value: stats.publishedLast7Days,
      sub: "Últimos 7 dias",
      icon: CheckCircle2,
      iconClass: "text-ig-success bg-emerald-500/10",
      valueClass: "text-ig-text",
    },
    {
      label: "Falhas",
      value: stats.failed,
      sub: stats.failed > 0 ? "Confira os logs" : "Tudo certo por aqui",
      icon: XCircle,
      iconClass: "text-ig-danger bg-ig-danger/10",
      valueClass: stats.failed > 0 ? "text-ig-danger" : "text-ig-text",
    },
  ] as const;

  return (
    <div className="grid gap-3 sm:grid-cols-3">
      {cards.map((card) => {
        const Icon = card.icon;
        return (
          <div key={card.label} className="ig-stat flex items-start gap-3 p-4">
            <div
              className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${card.iconClass}`}
            >
              <Icon size={20} strokeWidth={1.75} />
            </div>
            <div className="min-w-0">
              <p className="text-sm text-ig-muted">{card.label}</p>
              <p className={`text-2xl font-normal leading-tight ${card.valueClass}`}>
                {card.value}
              </p>
              <p className="mt-0.5 text-xs text-ig-muted">{card.sub}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
