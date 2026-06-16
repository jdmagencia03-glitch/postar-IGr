import { BarChart3, Brain, Calendar, LayoutGrid, List, LogOut, Upload, Users } from "lucide-react";
import { AccountStatusBadge } from "@/components/AccountStatusBadge";
import { ThemeToggle } from "@/components/ThemeToggle";

const links = [
  { href: "/dashboard", label: "Início", shortLabel: "Início", icon: LayoutGrid },
  { href: "/dashboard/bulk", label: "Agendar posts", shortLabel: "Agendar", icon: Upload },
  { href: "/dashboard/ai", label: "Assistente de Conteúdo", shortLabel: "Conteúdo", icon: Brain },
  { href: "/dashboard/accounts", label: "Contas", shortLabel: "Contas", icon: Users },
  { href: "/dashboard/reports", label: "Central de Operações", shortLabel: "Operações", icon: BarChart3 },
  { href: "/dashboard/calendar", label: "Calendário", shortLabel: "Calend.", icon: Calendar },
  { href: "/dashboard/logs", label: "Logs", shortLabel: "Logs", icon: List },
];

export function Navbar() {
  return (
    <header className="ig-navbar">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
        <a
          href="/dashboard"
          className="ig-brand-script text-2xl leading-none text-ig-text sm:text-3xl"
        >
          Postar<span className="ig-brand-gradient">IGr</span>
        </a>
        <nav className="flex items-center gap-0.5">
          <ThemeToggle />
          <AccountStatusBadge />
          {links.map(({ href, label, shortLabel, icon: Icon }) => (
            <a
              key={href}
              href={href}
              title={label}
              className="flex flex-col items-center gap-0.5 rounded-lg px-2 py-2 text-ig-muted transition hover:text-ig-text sm:flex-row sm:gap-2 sm:px-3"
            >
              <Icon size={22} strokeWidth={1.75} />
              <span className="text-[10px] font-semibold sm:text-xs">{shortLabel}</span>
            </a>
          ))}
          <a
            href="/api/auth/logout"
            title="Sair"
            className="ml-1 flex flex-col items-center gap-0.5 rounded-lg px-2 py-2 text-ig-muted transition hover:text-ig-danger sm:ml-2 sm:flex-row sm:gap-2 sm:px-3"
          >
            <LogOut size={22} strokeWidth={1.75} />
            <span className="text-[10px] font-semibold sm:text-xs">Sair</span>
          </a>
        </nav>
      </div>
    </header>
  );
}
