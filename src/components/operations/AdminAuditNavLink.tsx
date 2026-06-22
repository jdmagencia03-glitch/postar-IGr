"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ShieldAlert } from "lucide-react";
import { fetchWithTimeout } from "@/lib/client-fetch-timeout";

export function AdminAuditNavLink({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const [allowed, setAllowed] = useState(false);
  const active = pathname.startsWith("/dashboard/operations/audit");

  useEffect(() => {
    fetchWithTimeout("/api/admin/audit/access", { credentials: "include", cache: "no-store" }, 3_000)
      .then((res) => res.json())
      .then((data) => setAllowed(Boolean(data.allowed)))
      .catch(() => setAllowed(false));
  }, []);

  if (!allowed) return null;

  return (
    <Link
      href="/dashboard/operations/audit"
      onClick={onNavigate}
      className={`ig-nav-link ${active ? "ig-nav-link-active" : ""}`}
    >
      <ShieldAlert size={20} strokeWidth={1.75} className="shrink-0" />
      <span className="truncate">Diagnóstico Admin</span>
    </Link>
  );
}
