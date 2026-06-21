"use client";

import { AlertTriangle, CheckCircle2, Music2, Share2 } from "lucide-react";
import { resolveMetaOAuthError } from "@/lib/meta/errors";
import { resolveTikTokOAuthError } from "@/lib/tiktok/errors";

interface Props {
  error?: string | null;
  connected?: string | null;
  platform?: "instagram" | "tiktok";
  facebookEnabled?: boolean;
  tiktokEnabled?: boolean;
}

export function OAuthAlert({
  error,
  connected,
  platform,
  facebookEnabled = true,
  tiktokEnabled = true,
}: Props) {
  const guide =
    platform === "tiktok" ? resolveTikTokOAuthError(error) : resolveMetaOAuthError(error);
  const connectedCount = Number(connected ?? 0);

  return (
    <div className="space-y-4">
      {connectedCount > 0 && (
        <div className="flex items-start gap-3 rounded-xl border border-ig-border bg-ig-elevated px-4 py-3 text-sm text-ig-text">
          <CheckCircle2 size={18} className="mt-0.5 shrink-0" />
          <p>
            {platform === "tiktok"
              ? "Conta TikTok conectada com sucesso!"
              : connectedCount === 1
                ? "Conta conectada com sucesso!"
                : `${connectedCount} contas conectadas com sucesso!`}
          </p>
        </div>
      )}

      {guide && (
        <div className="rounded-xl border border-ig-border bg-ig-elevated px-4 py-4 text-sm text-ig-muted">
          <div className="mb-2 flex items-center gap-2 font-semibold text-ig-muted">
            <AlertTriangle size={16} />
            {guide.title}
          </div>
          <p className="mb-3 text-ig-muted">{guide.message}</p>
          <ol className="list-decimal space-y-1 pl-5 text-xs text-ig-muted">
            {guide.steps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>

          {platform !== "tiktok" && facebookEnabled && (
            <div className="mt-4 flex flex-wrap gap-2">
              <a
                href="/api/auth/facebook?next=/dashboard/accounts&add_account=1"
                className="inline-flex items-center gap-2 rounded-lg bg-ig-facebook px-4 py-2 text-xs font-medium text-white hover:opacity-90"
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

          {platform === "tiktok" && tiktokEnabled && (
            <div className="mt-4">
              <a
                href="/api/auth/tiktok?next=/dashboard/tiktok&add_account=1"
                className="inline-flex items-center gap-2 rounded-lg border border-ig-border bg-ig-secondary px-4 py-2 text-xs text-ig-text hover:bg-ig-surface"
              >
                <Music2 size={14} />
                Tentar conectar TikTok novamente
              </a>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
