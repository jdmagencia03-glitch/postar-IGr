import Link from "next/link";
import { Calendar, LayoutGrid, List, LogOut, Upload } from "lucide-react";

const links = [
  { href: "/dashboard", label: "Início", icon: LayoutGrid },
  { href: "/dashboard/bulk", label: "Agendamento em massa", icon: Upload },
  { href: "/dashboard/calendar", label: "Calendário", icon: Calendar },
  { href: "/dashboard/logs", label: "Logs", icon: List },
];

export function Navbar() {
  return (
    <header className="border-b border-white/10 bg-black/40 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4">
        <Link href="/dashboard" className="text-lg font-semibold text-white">
          Insta<span className="text-pink-400">Scheduler</span>
        </Link>
        <nav className="flex items-center gap-1">
          {links.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-zinc-300 transition hover:bg-white/10 hover:text-white"
            >
              <Icon size={16} />
              <span className="hidden sm:inline">{label}</span>
            </Link>
          ))}
          <Link
            href="/api/auth/logout"
            className="ml-2 flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-zinc-400 transition hover:bg-white/10 hover:text-white"
          >
            <LogOut size={16} />
          </Link>
        </nav>
      </div>
    </header>
  );
}
