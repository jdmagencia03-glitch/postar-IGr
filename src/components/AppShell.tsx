"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  Brain,
  Calendar,
  LayoutGrid,
  List,
  LogOut,
  Menu,
  Music2,
  PenSquare,
  Search,
  Upload,
  Users,
  X,
} from "lucide-react";
import { AccountStatusBadge } from "@/components/AccountStatusBadge";
import { BrandLogo } from "@/components/BrandLogo";
import { ThemeToggle } from "@/components/ThemeToggle";
import { APP_NAME } from "@/lib/brand";

const links = [
  { href: "/dashboard", label: "Início", icon: LayoutGrid, exact: true },
  { href: "/dashboard/bulk", label: "Agendar posts", icon: Upload },
  { href: "/dashboard/tiktok", label: "TikTok", icon: Music2 },
  { href: "/dashboard/ai", label: "Assistente de conteúdo", icon: Brain },
  { href: "/dashboard/accounts", label: "Contas", icon: Users },
  { href: "/dashboard/reports", label: "Operações", icon: BarChart3 },
  { href: "/dashboard/calendar", label: "Calendário", icon: Calendar },
  { href: "/dashboard/logs", label: "Logs", icon: List },
];

function isActive(pathname: string, href: string, exact?: boolean) {
  if (exact) return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

function SidebarNav({
  pathname,
  onNavigate,
}: {
  pathname: string;
  onNavigate?: () => void;
}) {
  return (
    <nav className="flex flex-col gap-0.5">
      {links.map((link) => {
        const active = isActive(pathname, link.href, link.exact);
        const Icon = link.icon;
        return (
          <a
            key={link.href}
            href={link.href}
            onClick={onNavigate}
            className={`ig-nav-link ${active ? "ig-nav-link-active" : ""}`}
          >
            <Icon size={20} strokeWidth={1.75} className="shrink-0" />
            <span className="truncate">{link.label}</span>
          </a>
        );
      })}
    </nav>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="flex h-screen overflow-hidden bg-ig-bg">
      {mobileOpen && (
        <button
          type="button"
          aria-label="Fechar menu"
          className="fixed inset-0 z-40 bg-ig-overlay lg:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      <aside
        className={`ig-sidebar fixed inset-y-0 left-0 z-50 flex w-[260px] shrink-0 flex-col px-3 py-3 transition-transform lg:static lg:translate-x-0 ${
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="mb-4 flex items-center justify-between px-2 pt-1">
          <a href="/dashboard" aria-label={APP_NAME} onClick={() => setMobileOpen(false)}>
            <BrandLogo />
          </a>
          <button
            type="button"
            aria-label="Fechar menu"
            onClick={() => setMobileOpen(false)}
            className="rounded-full p-2 text-ig-muted hover:bg-ig-nav-hover lg:hidden"
          >
            <X size={20} />
          </button>
        </div>

        <a href="/dashboard/bulk" className="ig-compose-btn mb-4" onClick={() => setMobileOpen(false)}>
          <PenSquare size={20} strokeWidth={1.75} />
          Agendar posts
        </a>

        <SidebarNav pathname={pathname} onNavigate={() => setMobileOpen(false)} />

        <div className="mt-auto space-y-1 border-t border-ig-border pt-3">
          <a href="/api/auth/logout" className="ig-nav-link text-ig-muted hover:text-ig-danger">
            <LogOut size={20} strokeWidth={1.75} className="shrink-0" />
            <span>Sair</span>
          </a>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="ig-topbar flex shrink-0 items-center gap-3 px-4 py-2">
          <button
            type="button"
            aria-label="Abrir menu"
            onClick={() => setMobileOpen(true)}
            className="rounded-full p-2.5 text-ig-muted hover:bg-ig-nav-hover lg:hidden"
          >
            <Menu size={20} />
          </button>

          <a href="/dashboard" className="lg:hidden">
            <BrandLogo className="text-lg font-semibold text-ig-text" compact />
          </a>

          <div className="ig-search hidden min-w-0 flex-1 sm:flex">
            <Search size={18} className="shrink-0 text-ig-muted" strokeWidth={1.75} />
            <input
              type="search"
              placeholder="Buscar posts, contas..."
              className="min-w-0 flex-1 bg-transparent text-sm text-ig-text outline-none placeholder:text-ig-muted"
              readOnly
              aria-label="Buscar"
            />
          </div>

          <div className="ml-auto flex items-center gap-1">
            <ThemeToggle />
            <AccountStatusBadge />
          </div>
        </header>

        <main className="flex-1 overflow-y-auto px-4 pb-8 pt-2 lg:px-6">{children}</main>
      </div>
    </div>
  );
}
