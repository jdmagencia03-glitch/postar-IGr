"use client";

import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";

export function ThemeToggle({ compact = false }: { compact?: boolean }) {
  const { theme, setTheme, resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  if (!mounted) {
    return (
      <button
        type="button"
        aria-label="Alternar tema"
        className="flex items-center justify-center rounded-lg p-2 text-ig-muted"
        disabled
      >
        <Sun size={20} strokeWidth={1.75} />
      </button>
    );
  }

  const isDark = (resolvedTheme ?? theme) === "dark";

  return (
    <button
      type="button"
      onClick={() => setTheme(isDark ? "light" : "dark")}
      title={isDark ? "Mudar para tema claro" : "Mudar para tema escuro"}
      aria-label={isDark ? "Mudar para tema claro" : "Mudar para tema escuro"}
      className={
        compact
          ? "flex items-center justify-center rounded-lg p-2 text-ig-muted transition hover:bg-ig-secondary hover:text-ig-text"
          : "flex flex-col items-center gap-0.5 rounded-lg px-2 py-2 text-ig-muted transition hover:bg-ig-secondary hover:text-ig-text sm:flex-row sm:gap-2 sm:px-3"
      }
    >
      {isDark ? <Sun size={20} strokeWidth={1.75} /> : <Moon size={20} strokeWidth={1.75} />}
      {!compact && (
        <span className="text-[10px] font-semibold sm:text-xs">
          {isDark ? "Claro" : "Escuro"}
        </span>
      )}
    </button>
  );
}
