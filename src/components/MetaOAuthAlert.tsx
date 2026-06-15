"use client";

import { AlertTriangle, CheckCircle2, Share2 } from "lucide-react";
import { resolveMetaOAuthError } from "@/lib/meta/errors";

interface Props {
  error?: string | null;
  connected?: string | null;
  facebookEnabled?: boolean;
}

export function MetaOAuthAlert({ error, connected, facebookEnabled = true }: Props) {
  const guide = resolveMetaOAuthError(error);
  const connectedCount = Number(connected ?? 0);

  return (
    <div className="space-y-4">
      {connectedCount > 0 && (
        <div className="flex items-start gap-3 rounded-xl border border-ig-success/30 bg-ig-success/10 px-4 py-3 text-sm text-ig-success">
          <CheckCircle2 size={18} className="mt-0.5 shrink-0" />
          <p>
            {connectedCount === 1
              ? "Conta conectada com sucesso!"
              : `${connectedCount} contas conectadas com sucesso!`}
          </p>
        </div>
      )}

      {guide && (
        <div className="rounded-xl border border-ig-warning/30 bg-ig-warning/10 px-4 py-4 text-sm text-ig-warning">
          <div className="mb-2 flex items-center gap-2 font-semibold text-ig-warning">
            <AlertTriangle size={16} />
            {guide.title}
          </div>
          <p className="mb-3 text-ig-warning/90">{guide.message}</p>
          <ol className="list-decimal space-y-1 pl-5 text-xs text-ig-warning/80">
            {guide.steps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>

          {facebookEnabled && (
            <div className="mt-4 flex flex-wrap gap-2">
              <a
                href="/api/auth/facebook?next=/dashboard/accounts&add_account=1"
                className="inline-flex items-center gap-2 rounded-lg bg-[#1877F2] px-4 py-2 text-xs font-medium text-ig-text hover:opacity-90"
              >
                <Share2 size={14} />
                Tentar via Facebook (automático)
              </a>
              <a
                href="/api/auth/meta?next=/dashboard/accounts&add_account=1"
                className="rounded-lg border border-ig-border bg-ig-elevated px-4 py-2 text-xs text-ig-text hover:bg-ig-secondary"
              >
                Tentar Instagram direto (aba anônima)
              </a>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
