import { BarChart3, Brain, Calendar, LayoutGrid, List, LogOut, Upload, Users } from "lucide-react";
import { AccountStatusBadge } from "@/components/AccountStatusBadge";

const links = [
  { href: "/dashboard", label: "Início", shortLabel: "Início", icon: LayoutGrid },
  { href: "/dashboard/bulk", label: "Agendar posts", shortLabel: "Agendar", icon: Upload },
  { href: "/dashboard/ai", label: "Treinar IA", shortLabel: "IA", icon: Brain },
  { href: "/dashboard/accounts", label: "Contas", shortLabel: "Contas", icon: Users },
  { href: "/dashboard/reports", label: "Relatório", shortLabel: "Relatório", icon: BarChart3 },
  { href: "/dashboard/calendar", label: "Calendário", shortLabel: "Calend.", icon: Calendar },
  { href: "/dashboard/logs", label: "Logs", shortLabel: "Logs", icon: List },
];

export function Navbar() {
  return (
    <header className="border-b border-white/10 bg-black/40 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4">
        <a href="/dashboard" className="text-lg font-semibold text-white">
          Insta<span className="text-pink-400">Scheduler</span>
        </a>
        <nav className="flex items-center gap-1">
          <AccountStatusBadge />
          {links.map(({ href, label, shortLabel, icon: Icon }) => (
            <a
              key={href}
              href={href}
              title={label}
              className="flex flex-col items-center gap-0.5 rounded-lg px-2 py-2 text-zinc-300 transition hover:bg-white/10 hover:text-white sm:flex-row sm:gap-2 sm:px-3"
            >
              <Icon size={16} />
              <span className="text-[10px] sm:text-sm">{shortLabel}</span>
            </a>
          ))}
          <a
            href="/api/auth/logout"
            title="Sair"
            className="ml-1 flex flex-col items-center gap-0.5 rounded-lg border border-white/10 px-2 py-2 text-zinc-400 transition hover:bg-red-500/10 hover:text-red-300 sm:ml-2 sm:flex-row sm:gap-2 sm:px-3"
          >
            <LogOut size={16} />
            <span className="text-[10px] sm:text-sm">Sair</span>
          </a>
        </nav>
      </div>
    </header>
  );
}
