"use client";

import { useState } from "react";
import {
  BarChart3,
  Brain,
  Calendar,
  LayoutGrid,
  List,
  LogOut,
  Menu,
  Music2,
  Upload,
  Users,
  X,
} from "lucide-react";
import { AccountStatusBadge } from "@/components/AccountStatusBadge";
import { ThemeToggle } from "@/components/ThemeToggle";

const links = [
  { href: "/dashboard", label: "Início", shortLabel: "Início", icon: LayoutGrid },
  { href: "/dashboard/bulk", label: "Agendar posts", shortLabel: "Agendar", icon: Upload },
  { href: "/dashboard/tiktok", label: "Dashboard TikTok", shortLabel: "TikTok", icon: Music2 },
  { href: "/dashboard/ai", label: "Assistente de Conteúdo", shortLabel: "Conteúdo", icon: Brain },
  { href: "/dashboard/accounts", label: "Contas", shortLabel: "Contas", icon: Users },
  { href: "/dashboard/reports", label: "Central de Operações", shortLabel: "Operações", icon: BarChart3 },
  { href: "/dashboard/calendar", label: "Calendário", shortLabel: "Calend.", icon: Calendar },
  { href: "/dashboard/logs", label: "Logs", shortLabel: "Logs", icon: List },
];

function NavLink({
  href,
  label,
  shortLabel,
  icon: Icon,
  onNavigate,
}: {
  href: string;
  label: string;
  shortLabel: string;
  icon: typeof LayoutGrid;
  onNavigate?: () => void;
}) {
  return (
    <a
      href={href}
      title={label}
      onClick={onNavigate}
      className="flex flex-col items-center gap-0.5 rounded-lg px-2 py-2 text-ig-muted transition hover:text-ig-text sm:flex-row sm:gap-2 sm:px-3"
    >
      <Icon size={22} strokeWidth={1.75} />
      <span className="text-[10px] font-semibold sm:text-xs">{shortLabel}</span>
    </a>
  );
}

export function Navbar() {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <header className="ig-navbar">
      <div className="mx-auto max-w-6xl px-4 py-3">
        <div className="flex items-center justify-between">
          <a
            href="/dashboard"
            className="ig-brand-script text-2xl leading-none text-ig-text sm:text-3xl"
          >
            Postar<span className="ig-brand-gradient">IGr</span>
          </a>
          <nav className="flex items-center gap-0.5">
            <ThemeToggle />
            <AccountStatusBadge />
            <div className="hidden items-center gap-0.5 sm:flex">
              {links.map((link) => (
                <NavLink key={link.href} {...link} />
              ))}
              <a
                href="/api/auth/logout"
                title="Sair"
                className="ml-2 flex flex-row items-center gap-2 rounded-lg px-3 py-2 text-ig-muted transition hover:text-ig-danger"
              >
                <LogOut size={22} strokeWidth={1.75} />
                <span className="text-xs font-semibold">Sair</span>
              </a>
            </div>
            <button
              type="button"
              aria-label={menuOpen ? "Fechar menu" : "Abrir menu"}
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((open) => !open)}
              className="rounded-lg p-2 text-ig-muted transition hover:bg-ig-secondary hover:text-ig-text sm:hidden"
            >
              {menuOpen ? <X size={24} /> : <Menu size={24} />}
            </button>
          </nav>
        </div>

        {menuOpen && (
          <div className="mt-3 grid gap-1 border-t border-ig-border pt-3 sm:hidden">
            {links.map((link) => (
              <NavLink key={link.href} {...link} onNavigate={() => setMenuOpen(false)} />
            ))}
            <a
              href="/api/auth/logout"
              title="Sair"
              onClick={() => setMenuOpen(false)}
              className="flex items-center gap-2 rounded-lg px-2 py-2 text-ig-muted transition hover:text-ig-danger"
            >
              <LogOut size={22} strokeWidth={1.75} />
              <span className="text-sm font-semibold">Sair</span>
            </a>
          </div>
        )}
      </div>
    </header>
  );
}
