"use client";

import Link from "next/link";
import { cn } from "@/lib/utils";
import {
  AlertTriangle,
  Brain,
  Calendar,
  CircleDot,
  ExternalLink,
  Pause,
  Play,
  Upload,
} from "lucide-react";
import { ValidatePermissionsButton } from "@/components/operations/ValidatePermissionsButton";
import {
  healthClass,
  healthLabel,
  type AccountOperationsSummary,
} from "@/lib/operations/account-ops";
import { formatTokenStatusLabel } from "@/lib/operations/token-status";
import type { AccountOperationalSummary } from "@/lib/operations/operational-summary";
import { formatShortDateTime } from "@/lib/operations/compute";

interface Props {
  accounts: AccountOperationalSummary[];
}

function platformLabel(platform: AccountOperationsSummary["platform"]) {
  return platform === "tiktok" ? "TikTok" : "Instagram";
}

export function AccountOperationsGrid({ accounts }: Props) {
  if (!accounts.length) {
    return (
      <div className="rounded-2xl border border-dashed border-ig-border p-8 text-center text-sm text-ig-muted">
        Nenhuma conta conectada.{" "}
        <Link href="/dashboard/accounts" className="text-ig-primary hover:underline">
          Conectar contas
        </Link>
      </div>
    );
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
      {accounts.map((account) => {
        const username = account.username ? `@${account.username}` : "conta";
        const reconnectHref =
          account.platform === "tiktok"
            ? `/api/tiktok/connect?next=/dashboard/accounts/${account.id}/diagnostics?platform=tiktok&add_account=1`
            : `/api/auth/meta?next=/dashboard/accounts/${account.id}/diagnostics?platform=instagram`;

        return (
          <article
            key={`${account.platform}-${account.id}`}
            className="rounded-2xl border border-ig-border bg-ig-elevated p-5"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-ig-muted">
                  {platformLabel(account.platform)}
                </p>
                <h3 className="mt-1 text-lg font-semibold text-ig-text">{username}</h3>
                {account.niche && (
                  <p className="mt-1 text-sm text-ig-muted">Nicho: {account.niche}</p>
                )}
              </div>
              <span
                className={`rounded-full px-2.5 py-1 text-xs font-semibold ${healthClass(account.health)}`}
              >
                {healthLabel(account.health)}
              </span>
            </div>

            {account.duplicateSlotCount > 0 && (
              <p className="mt-2 text-xs font-medium text-amber-700">
                Horários duplicados detectados ({account.duplicateSlotCount})
              </p>
            )}

            <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
              <div>
                <dt className="text-ig-muted">Hoje</dt>
                <dd className="font-semibold text-ig-text">{account.publishedToday}</dd>
              </div>
              <div>
                <dt className="text-ig-muted">7 dias</dt>
                <dd className="font-semibold text-ig-text">{account.publishedLast7Days}</dd>
              </div>
              <div>
                <dt className="text-ig-muted">30 dias</dt>
                <dd className="font-semibold text-ig-text">{account.publishedLast30Days}</dd>
              </div>
              <div>
                <dt className="text-ig-muted">Programados</dt>
                <dd className="font-semibold text-ig-text">{account.pendingCount}</dd>
              </div>
              <div>
                <dt className="text-ig-muted">Falhas</dt>
                <dd className="font-semibold text-ig-danger">{account.failedCount}</dd>
              </div>
              <div>
                <dt className="text-ig-muted">Taxa sucesso</dt>
                <dd className="font-semibold text-ig-text">{account.successRate}%</dd>
              </div>
            </dl>

            <div className="mt-3 space-y-1 text-xs text-ig-muted">
              {account.topContentType && (
                <p>
                  Tipo mais usado:{" "}
                  <span className="font-medium text-ig-text">{account.topContentType}</span>
                </p>
              )}
              <p>
                Token:{" "}
                <span
                  className={cn(
                    "font-medium",
                    account.tokenStatus === "valid"
                      ? "text-emerald-600"
                      : account.tokenStatus === "expired"
                        ? "text-ig-danger"
                        : "text-ig-text",
                  )}
                >
                  {formatTokenStatusLabel(account.tokenStatus)}
                </span>
              </p>
              <p>
                Assistente:{" "}
                <span className="font-medium text-ig-text">
                  {account.playbookConfigured ? "Configurado" : "Pendente"}
                </span>
              </p>
              {account.nextPublication && (
                <p>
                  Próxima:{" "}
                  <span className="font-medium text-ig-text">
                    {formatShortDateTime(account.nextPublication)}
                  </span>
                </p>
              )}
              {account.lastError && account.health !== "healthy" && (
                <p className="flex items-start gap-1 text-ig-danger">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span className="line-clamp-2">{account.lastError}</span>
                </p>
              )}
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              <ValidatePermissionsButton
                accountId={account.id}
                platform={account.platform}
                compact
              />
              <Link
                href={`/dashboard/reports?view=audit&account=${account.id}&platform=${account.platform}`}
                className="rounded-lg border border-ig-border px-3 py-1.5 text-xs font-medium hover:bg-ig-secondary"
              >
                Conferir
              </Link>
              <Link
                href={`/dashboard/accounts/${account.id}/diagnostics?platform=${account.platform}`}
                className="rounded-lg border border-ig-border px-3 py-1.5 text-xs font-medium hover:bg-ig-secondary"
              >
                Ver detalhes
              </Link>
              <Link
                href="/dashboard/bulk"
                className="rounded-lg border border-ig-border px-3 py-1.5 text-xs font-medium hover:bg-ig-secondary"
              >
                <Upload className="mr-1 inline h-3.5 w-3.5" />
                Agendar
              </Link>
              {account.platform === "instagram" && (
                <Link
                  href="/dashboard/stories"
                  className="rounded-lg border border-ig-border px-3 py-1.5 text-xs font-medium hover:bg-ig-secondary"
                >
                  <CircleDot className="mr-1 inline h-3.5 w-3.5" />
                  Stories
                </Link>
              )}
              {account.failedCount > 0 && (
                <Link
                  href={`/dashboard/reports?status=failed&account=${account.id}`}
                  className="rounded-lg border border-ig-danger/30 px-3 py-1.5 text-xs font-medium text-ig-danger hover:bg-ig-danger/10"
                >
                  Ver erros
                </Link>
              )}
              {!account.playbookConfigured && (
                <Link
                  href={`/dashboard/ai?account=${account.id}`}
                  className="rounded-lg border border-ig-border px-3 py-1.5 text-xs font-medium hover:bg-ig-secondary"
                >
                  <Brain className="mr-1 inline h-3.5 w-3.5" />
                  Assistente
                </Link>
              )}
              {account.tokenStatus === "expired" && (
                <a
                  href={reconnectHref}
                  className="rounded-lg border border-ig-primary/30 px-3 py-1.5 text-xs font-medium text-ig-primary hover:bg-ig-primary/10"
                >
                  <ExternalLink className="mr-1 inline h-3.5 w-3.5" />
                  Reconectar
                </a>
              )}
              {account.publishingPaused ? (
                <span className="inline-flex items-center rounded-lg bg-amber-500/10 px-3 py-1.5 text-xs font-medium text-amber-700">
                  <Pause className="mr-1 h-3.5 w-3.5" />
                  Pausada
                </span>
              ) : (
                <span className="inline-flex items-center rounded-lg bg-emerald-500/10 px-3 py-1.5 text-xs font-medium text-emerald-700">
                  <Play className="mr-1 h-3.5 w-3.5" />
                  Ativa
                </span>
              )}
            </div>
          </article>
        );
      })}
    </div>
  );
}
