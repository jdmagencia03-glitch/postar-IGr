"use client";

import { useState } from "react";
import { ShieldCheck } from "lucide-react";
import type { SocialPlatform } from "@/lib/types";

interface ValidationResult {
  overall: "ok" | "attention" | "error";
  summary: string;
  checks: Array<{ label: string; level: string; message: string }>;
}

interface Props {
  accountId: string;
  platform: SocialPlatform;
  compact?: boolean;
}

export function ValidatePermissionsButton({ accountId, platform, compact = false }: Props) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ValidationResult | null>(null);

  async function validate() {
    setLoading(true);
    try {
      const res = await fetch(
        `/api/operations/accounts/${accountId}/validate?platform=${platform}`,
        { credentials: "include", cache: "no-store" },
      );
      const data = await res.json();
      if (res.ok) setResult(data);
      else setResult({ overall: "error", summary: data.error ?? "Falha", checks: [] });
    } catch {
      setResult({ overall: "error", summary: "Erro de rede", checks: [] });
    } finally {
      setLoading(false);
    }
  }

  const tone =
    result?.overall === "ok"
      ? "text-emerald-700 bg-emerald-500/10 border-emerald-500/30"
      : result?.overall === "attention"
        ? "text-amber-700 bg-amber-500/10 border-amber-500/30"
        : result?.overall === "error"
          ? "text-ig-danger bg-ig-danger/10 border-ig-danger/30"
          : "";

  return (
    <div className="space-y-2">
      <button
        type="button"
        disabled={loading}
        onClick={() => void validate()}
        className={
          compact
            ? "rounded-lg border border-ig-border px-3 py-1.5 text-xs font-medium hover:bg-ig-secondary disabled:opacity-50"
            : "ig-btn-secondary inline-flex items-center gap-2 px-4 py-2 text-sm disabled:opacity-50"
        }
      >
        <ShieldCheck className="h-4 w-4" />
        {loading ? "Validando…" : "Validar permissões"}
      </button>
      {result && (
        <div className={`rounded-xl border p-3 text-sm ${tone}`}>
          <p className="font-medium">{result.summary}</p>
          {result.checks.length > 0 && (
            <ul className="mt-2 space-y-1 text-xs">
              {result.checks.map((check) => (
                <li key={check.label}>
                  <span className="font-medium">{check.label}:</span> {check.message}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
