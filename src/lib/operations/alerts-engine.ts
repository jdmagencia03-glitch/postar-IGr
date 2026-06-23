import { differenceInHours, parseISO } from "date-fns";
import type { AccountOperationsSummary } from "@/lib/operations/account-ops";
import {
  accountDiagnosticsPath,
  accountErrorsPath,
} from "@/lib/operations/routes";
import type { ScheduledPost } from "@/lib/types";

export type AlertSeverity = "info" | "warning" | "critical";
export type AlertTone = "info" | "warning" | "danger";

export interface OperationsAlert {
  id: string;
  type: string;
  severity: AlertSeverity;
  tone: AlertTone;
  title: string;
  message: string;
  accountId?: string;
  accountPlatform?: "instagram" | "tiktok";
  accountUsername?: string | null;
  createdAt: string;
  actionHref?: string;
  actionLabel?: string;
}

function severityTone(severity: AlertSeverity): AlertTone {
  if (severity === "critical") return "danger";
  if (severity === "warning") return "warning";
  return "info";
}

function pushAlert(alerts: OperationsAlert[], alert: Omit<OperationsAlert, "tone" | "createdAt">) {
  alerts.push({
    ...alert,
    tone: severityTone(alert.severity),
    createdAt: new Date().toISOString(),
  });
}

export function buildOperationsAlerts(params: {
  accounts: AccountOperationsSummary[];
  posts: ScheduledPost[];
  coverageDays: number;
  cronConfigured: boolean;
  lastPublishAt: string | null;
  activeUploadBatchId: string | null;
}) {
  const alerts: OperationsAlert[] = [];
  const now = new Date();

  if (!params.cronConfigured) {
    pushAlert(alerts, {
      id: "cron-missing",
      type: "cron",
      severity: "critical",
      title: "Cron de publicação não configurado",
      message: "As publicações automáticas podem não sair até o cron ser configurado.",
      actionHref: "/dashboard/logs",
      actionLabel: "Ver logs",
    });
  }

  if (params.lastPublishAt) {
    const hoursSince = differenceInHours(now, parseISO(params.lastPublishAt));
    if (hoursSince >= 48 && params.posts.some((p) => p.status === "pending")) {
      pushAlert(alerts, {
        id: "cron-stale",
        type: "cron",
        severity: "warning",
        title: "Sem publicações recentes",
        message: `Nenhuma publicação com sucesso há ${hoursSince}h, mas há posts na fila.`,
        actionHref: "/dashboard/logs",
        actionLabel: "Ver logs",
      });
    }
  }

  if (params.coverageDays <= 5) {
    const pendingInQueue = params.posts.filter(
      (post) =>
        post.status === "pending" || post.status === "retrying" || post.status === "needs_media",
    ).length;
    if (pendingInQueue > 0) {
      pushAlert(alerts, {
        id: "low-queue",
        type: "queue",
        severity: "warning",
        title: "Conteúdo acabando",
      message: `Restam apenas ${params.coverageDays} dia(s) de conteúdo programado.`,
      actionHref: "/dashboard/bulk",
      actionLabel: "Agendar mais vídeos",
    });
    }
  }

  if (params.activeUploadBatchId) {
    pushAlert(alerts, {
      id: "upload-active",
      type: "upload",
      severity: "info",
      title: "Upload em andamento",
      message: "Há um lote de vídeos sendo enviado.",
      actionHref: "/dashboard/uploads",
      actionLabel: "Ver uploads",
    });
  }

  const stuckProcessing = params.posts.filter((p) => p.status === "processing");
  if (stuckProcessing.length > 0) {
    pushAlert(alerts, {
      id: "stuck-processing",
      type: "publish",
      severity: "warning",
      title: "Publicação presa em andamento",
      message: `${stuckProcessing.length} post(s) em “publicando” há mais tempo que o normal.`,
      actionHref: "/dashboard/errors",
      actionLabel: "Ver erros",
    });
  }

  for (const account of params.accounts) {
    const accountLabel = account.username ? `@${account.username}` : "conta";

    if (account.tokenStatus === "expired") {
      pushAlert(alerts, {
        id: `token-${account.id}`,
        type: "token",
        severity: "critical",
        title: "Conta desconectada",
        message: `${accountLabel} precisa ser reconectada.`,
        accountId: account.id,
        accountPlatform: account.platform,
        accountUsername: account.username,
        actionHref:
          account.platform === "tiktok"
            ? `/api/tiktok/connect?next=/dashboard/accounts/${account.id}/diagnostics?platform=tiktok&add_account=1`
            : `/api/auth/meta?next=/dashboard/accounts/${account.id}/diagnostics?platform=instagram`,
        actionLabel: "Reconectar",
      });
    }

    if (!account.playbookConfigured) {
      pushAlert(alerts, {
        id: `playbook-${account.id}`,
        type: "playbook",
        severity: "info",
        title: "Assistente não configurado",
        message: `${accountLabel} ainda não tem playbook de conteúdo.`,
        accountId: account.id,
        accountPlatform: account.platform,
        accountUsername: account.username,
        actionHref: `/dashboard/ai?account=${account.id}`,
        actionLabel: "Configurar assistente",
      });
    }

    if (account.failedCount > 0) {
      pushAlert(alerts, {
        id: `failed-${account.id}`,
        type: "publish",
        severity: account.failedCount >= 3 ? "critical" : "warning",
        title: "Publicações com falha",
        message: `${account.failedCount} post(s) com erro em ${accountLabel}.`,
        accountId: account.id,
        accountPlatform: account.platform,
        accountUsername: account.username,
        actionHref: accountErrorsPath(account.id, account.platform),
        actionLabel: "Ver erros",
      });
    }

    if (account.storiesBlocked > 0) {
      pushAlert(alerts, {
        id: `story-block-${account.id}`,
        type: "story",
        severity: "warning",
        title: "Stories bloqueados",
        message: `${account.storiesBlocked} story(s) aguardando permissão Meta em ${accountLabel}.`,
        accountId: account.id,
        accountPlatform: account.platform,
        accountUsername: account.username,
        actionHref: accountDiagnosticsPath(account.id, account.platform),
        actionLabel: "Ver diagnóstico",
      });
    }

    if (account.publishingPaused) {
      pushAlert(alerts, {
        id: `paused-${account.id}`,
        type: "account",
        severity: "info",
        title: "Publicações pausadas",
        message: `${accountLabel} está com publicação automática pausada.`,
        accountId: account.id,
        accountPlatform: account.platform,
        accountUsername: account.username,
        actionHref: accountDiagnosticsPath(account.id, account.platform),
        actionLabel: "Ver conta",
      });
    }

    if (account.health === "error" && account.tokenStatus !== "expired") {
      pushAlert(alerts, {
        id: `health-${account.id}`,
        type: "account",
        severity: "critical",
        title: "Conta precisa de atenção",
        message: account.lastError ?? `${accountLabel} com problemas operacionais.`,
        accountId: account.id,
        accountPlatform: account.platform,
        accountUsername: account.username,
        actionHref: accountDiagnosticsPath(account.id, account.platform),
        actionLabel: "Diagnosticar",
      });
    }
  }

  const severityOrder: Record<AlertSeverity, number> = {
    critical: 0,
    warning: 1,
    info: 2,
  };

  return alerts.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);
}
