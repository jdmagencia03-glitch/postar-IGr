"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  CheckCircle2,
  ChevronDown,
  Copy,
  ExternalLink,
  EyeOff,
  Loader2,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
} from "lucide-react";
import type {
  AuditScope,
  AuditSweepMeta,
  PlatformAuditResult,
  StoredAuditFinding,
} from "@/lib/operations/platform-audit/types";
import type { PlatformErrorAuditResult } from "@/lib/operations/platform-error-audit";

const TABS: { id: AuditScope; label: string }[] = [
  { id: "overview", label: "Visão Geral" },
  { id: "tiktok", label: "TikTok" },
  { id: "instagram", label: "Instagram" },
  { id: "schedule", label: "Agendamentos" },
  { id: "uploads", label: "Uploads" },
  { id: "publisher", label: "Publicador/Cron" },
  { id: "database", label: "Banco" },
  { id: "ui", label: "Relatórios/UI" },
];

const SEVERITY_STYLE: Record<string, string> = {
  critical: "bg-red-500/15 text-red-400 border-red-500/30",
  high: "bg-orange-500/15 text-orange-400 border-orange-500/30",
  medium: "bg-yellow-500/15 text-yellow-300 border-yellow-500/30",
  low: "bg-zinc-500/15 text-zinc-400 border-zinc-500/30",
};

const STATUS_STYLE: Record<string, string> = {
  open: "border-ig-border",
  validating: "border-blue-500/40 ring-1 ring-blue-500/20",
  resolved: "border-emerald-500/40 opacity-80",
  ignored: "border-zinc-500/40 opacity-70",
  reopened: "border-orange-500/50 ring-1 ring-orange-500/30",
};

const STATUS_LABEL: Record<string, string> = {
  open: "Aberto",
  validating: "Validando…",
  resolved: "Resolvido",
  ignored: "Ignorado",
  reopened: "Reaberto",
};

function formatWhen(iso: string | null | undefined) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
}

function relativeNext(iso: string | null | undefined) {
  if (!iso) return "em breve";
  const diff = new Date(iso).getTime() - Date.now();
  if (diff <= 0) return "em instantes";
  const min = Math.ceil(diff / 60_000);
  return `em ${min} min`;
}

function findingLinks(finding: StoredAuditFinding) {
  const links: { href: string; label: string }[] = [
    { href: "/dashboard/errors", label: "Central de Erros" },
    { href: "/dashboard/logs", label: "Logs" },
  ];

  if (finding.module === "schedule") {
    links.unshift({ href: "/dashboard/calendar", label: "Calendário" });
    links.unshift({ href: "/dashboard/operations/schedule-jobs", label: "Schedule Jobs" });
  }
  if (finding.module === "upload") {
    const batchId = finding.evidence.uploadBatchId as string | undefined;
    links.unshift({
      href: batchId ? `/dashboard/uploads/${batchId}` : "/dashboard/uploads",
      label: "Abrir lote",
    });
  }
  if (finding.platform === "tiktok") {
    links.unshift({ href: "/dashboard/tiktok", label: "Conta TikTok" });
  }
  if (finding.platform === "instagram") {
    links.unshift({ href: "/dashboard/accounts", label: "Contas Instagram" });
  }
  if (finding.module === "cron" || finding.module === "publisher") {
    links.unshift({ href: "/dashboard/reports", label: "Operações" });
  }

  return links;
}

function FindingCard({
  finding,
  onValidate,
  onIgnore,
  validating,
  validationMessage,
}: {
  finding: StoredAuditFinding;
  onValidate: (fingerprint: string) => void;
  onIgnore: (fingerprint: string) => void;
  validating: boolean;
  validationMessage?: string | null;
}) {
  const [showEvidence, setShowEvidence] = useState(false);
  const links = findingLinks(finding);

  const copyDetails = async () => {
    const text = JSON.stringify(
      {
        fingerprint: finding.fingerprint,
        title: finding.title,
        severity: finding.severity,
        account: finding.accountHandle,
        platform: finding.platform,
        evidence: finding.evidence,
      },
      null,
      2,
    );
    await navigator.clipboard.writeText(text);
  };

  return (
    <article
      className={`rounded-xl border bg-ig-surface p-4 ${STATUS_STYLE[finding.status] ?? STATUS_STYLE.open}`}
    >
      {finding.status === "reopened" && (
        <p className="mb-2 rounded-lg bg-orange-500/10 px-3 py-2 text-sm text-orange-300">
          Erro voltou a aparecer após ter sido resolvido.
        </p>
      )}

      <div className="flex flex-wrap items-start gap-2">
        <span
          className={`rounded-full border px-2 py-0.5 text-xs font-medium uppercase ${SEVERITY_STYLE[finding.severity]}`}
        >
          {finding.severity}
        </span>
        <span className="rounded-full bg-ig-nav-hover px-2 py-0.5 text-xs text-ig-muted">
          {STATUS_LABEL[finding.status] ?? finding.status}
        </span>
        <span className="rounded-full bg-ig-nav-hover px-2 py-0.5 text-xs text-ig-muted">
          {finding.module}
        </span>
        <span className="rounded-full bg-ig-nav-hover px-2 py-0.5 text-xs text-ig-muted">
          {finding.platform}
        </span>
        {finding.accountHandle && (
          <span className="text-xs font-medium text-ig-text">{finding.accountHandle}</span>
        )}
      </div>

      <h3 className="mt-3 font-semibold text-ig-text">{finding.title}</h3>
      <p className="mt-1 text-sm text-ig-muted">{finding.description}</p>

      <dl className="mt-3 grid gap-1 text-xs text-ig-muted sm:grid-cols-2">
        <div>
          <dt className="font-medium text-ig-text">Detectado</dt>
          <dd>{formatWhen(finding.firstSeenAt)}</dd>
        </div>
        <div>
          <dt className="font-medium text-ig-text">Última vez</dt>
          <dd>{formatWhen(finding.lastSeenAt)}</dd>
        </div>
        <div>
          <dt className="font-medium text-ig-text">Ocorrências</dt>
          <dd>{finding.occurrenceCount}</dd>
        </div>
        <div>
          <dt className="font-medium text-ig-text">Validações</dt>
          <dd>{finding.validationCount}</dd>
        </div>
        {finding.lastValidatedAt && (
          <>
            <div>
              <dt className="font-medium text-ig-text">Última validação</dt>
              <dd>{formatWhen(finding.lastValidatedAt)}</dd>
            </div>
            <div>
              <dt className="font-medium text-ig-text">Resultado</dt>
              <dd>{finding.lastValidationResult?.message ?? "—"}</dd>
            </div>
          </>
        )}
      </dl>

      <dl className="mt-3 space-y-1 text-sm">
        <div>
          <dt className="inline font-medium text-ig-text">Causa provável: </dt>
          <dd className="inline text-ig-muted">{finding.probableCause}</dd>
        </div>
        <div>
          <dt className="inline font-medium text-ig-text">Correção: </dt>
          <dd className="inline text-ig-muted">{finding.recommendedFix}</dd>
        </div>
      </dl>

      {validationMessage && (
        <p
          className={`mt-3 rounded-lg px-3 py-2 text-sm ${
            finding.status === "resolved"
              ? "bg-emerald-500/10 text-emerald-300"
              : "bg-amber-500/10 text-amber-200"
          }`}
        >
          {validationMessage}
        </p>
      )}

      {showEvidence && Object.keys(finding.evidence).length > 0 && (
        <pre className="mt-3 max-h-48 overflow-auto rounded-lg bg-ig-bg p-3 text-xs text-ig-muted">
          {JSON.stringify(finding.evidence, null, 2)}
        </pre>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={validating || finding.status === "ignored"}
          onClick={() => onValidate(finding.fingerprint)}
          className="ig-btn-primary inline-flex items-center gap-1.5 text-sm"
        >
          {validating ? (
            <Loader2 size={14} className="animate-spin" />
          ) : finding.status === "resolved" ? (
            <ShieldCheck size={14} />
          ) : (
            <ShieldCheck size={14} />
          )}
          Validar resolução
        </button>
        <button
          type="button"
          onClick={() => setShowEvidence((v) => !v)}
          className="ig-btn-secondary text-sm"
        >
          {showEvidence ? "Ocultar evidência" : "Ver evidência"}
        </button>
        <button type="button" onClick={() => void copyDetails()} className="ig-btn-secondary text-sm">
          <Copy size={14} className="mr-1 inline" />
          Copiar
        </button>
        {finding.status !== "ignored" && (
          <button
            type="button"
            onClick={() => onIgnore(finding.fingerprint)}
            className="ig-btn-secondary text-sm text-ig-muted"
          >
            <EyeOff size={14} className="mr-1 inline" />
            Ignorar
          </button>
        )}
        {finding.module === "schedule" && (
          <Link href="/dashboard/reports" className="ig-btn-secondary text-sm">
            Dry-run horários
          </Link>
        )}
        {links.slice(0, 2).map((link) => (
          <Link key={link.href} href={link.href} className="ig-btn-secondary inline-flex items-center gap-1 text-sm">
            <ExternalLink size={14} />
            {link.label}
          </Link>
        ))}
      </div>

      <p className="mt-2 font-mono text-[10px] text-ig-muted">{finding.fingerprint}</p>
    </article>
  );
}

export function PlatformAuditPanel() {
  const [auditMode, setAuditMode] = useState<"owner" | "platform">("owner");
  const [platformSearch, setPlatformSearch] = useState("");
  const [platformAudit, setPlatformAudit] = useState<PlatformErrorAuditResult | null>(null);
  const [platformLoading, setPlatformLoading] = useState(false);
  const [platformError, setPlatformError] = useState<string | null>(null);
  const [scope, setScope] = useState<AuditScope>("overview");
  const [result, setResult] = useState<PlatformAuditResult | null>(null);
  const [findings, setFindings] = useState<StoredAuditFinding[]>([]);
  const [sweepMeta, setSweepMeta] = useState<AuditSweepMeta | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [runMenuOpen, setRunMenuOpen] = useState(false);
  const [validatingId, setValidatingId] = useState<string | null>(null);
  const [validationMessages, setValidationMessages] = useState<Record<string, string>>({});
  const [showResolved, setShowResolved] = useState(false);

  const loadFindings = useCallback(async (nextScope: AuditScope, includeResolved: boolean) => {
    const res = await fetch(
      `/api/admin/audit/findings?scope=${nextScope}&includeResolved=${includeResolved}`,
      { credentials: "include", cache: "no-store" },
    );
    if (!res.ok) return;
    const data = await res.json();
    setFindings(data.findings ?? []);
    if (data.sweepMeta) setSweepMeta(data.sweepMeta);
  }, []);

  const load = useCallback(
    async (nextScope: AuditScope, tier: "critical" | "schedule" | "full" = "full") => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/admin/audit/run?scope=${nextScope}&tier=${tier}`, {
          credentials: "include",
          cache: "no-store",
        });
        const data = await res.json();
        if (!res.ok) {
          setError(data.error ?? "Falha ao executar auditoria");
          setResult(null);
          return;
        }
        const audit = data as PlatformAuditResult;
        setResult(audit);
        if (audit.storedFindings?.length) {
          setFindings(audit.storedFindings);
        } else {
          await loadFindings(nextScope, showResolved);
        }
        if (audit.sweepMeta) setSweepMeta(audit.sweepMeta);
      } catch {
        setError("Erro de rede ao executar auditoria");
        setResult(null);
      } finally {
        setLoading(false);
      }
    },
    [loadFindings, showResolved],
  );

  useEffect(() => {
    if (auditMode !== "owner") return;
    void load(scope);
  }, [scope, load, auditMode]);

  useEffect(() => {
    const timer = setInterval(() => {
      void loadFindings(scope, showResolved);
    }, 60_000);
    return () => clearInterval(timer);
  }, [scope, showResolved, loadFindings]);

  const displayFindings = useMemo(() => {
    let list = findings.length ? findings : (result?.storedFindings ?? []);
    if (!list.length && result?.findings.length) {
      list = result.findings.map((f) => ({
        ...f,
        dbId: f.id,
        fingerprint: f.id,
        status: "open" as const,
        occurrenceCount: 1,
        validationCount: 0,
        firstSeenAt: result.ranAt,
        lastSeenAt: result.ranAt,
        resolvedAt: null,
        reopenedAt: null,
        ignoredAt: null,
        lastValidatedAt: null,
        lastValidatedBy: null,
        lastValidationResult: null,
      }));
    }
    if (!showResolved) {
      list = list.filter((f) => !["resolved", "ignored"].includes(f.status));
    }
    return list;
  }, [findings, result, showResolved]);

  const validateFinding = async (fingerprint: string) => {
    setValidatingId(fingerprint);
    setValidationMessages((prev) => ({ ...prev, [fingerprint]: "Validando…" }));
    try {
      const res = await fetch("/api/admin/audit/validate", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fingerprint }),
      });
      const data = await res.json();
      if (!res.ok) {
        setValidationMessages((prev) => ({
          ...prev,
          [fingerprint]: data.error ?? "Falha na validação",
        }));
        return;
      }
      setValidationMessages((prev) => ({
        ...prev,
        [fingerprint]: data.message as string,
      }));
      if (data.sweepMeta) setSweepMeta(data.sweepMeta);
      await loadFindings(scope, showResolved);
    } catch {
      setValidationMessages((prev) => ({
        ...prev,
        [fingerprint]: "Erro de rede na validação",
      }));
    } finally {
      setValidatingId(null);
    }
  };

  const ignoreFinding = async (fingerprint: string) => {
    await fetch("/api/admin/audit/ignore", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fingerprint }),
    });
    await loadFindings(scope, showResolved);
  };

  const summary = result?.summary;
  const lastSweep =
    sweepMeta?.lastFullSweepAt ??
    sweepMeta?.lastCriticalSweepAt ??
    result?.ranAt ??
    null;

  async function runPlatformAudit(search?: string) {
    setPlatformLoading(true);
    setPlatformError(null);
    try {
      const res = await fetch("/api/admin/errors/platform-audit", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scope: "platform",
          accountSearch: search?.trim() || undefined,
          includeAccounts: true,
          includePosts: true,
          includeOperationalErrors: true,
          includeOwners: true,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setPlatformError(data.error ?? data.message ?? "Falha na auditoria platform-wide");
        setPlatformAudit(null);
        return;
      }
      setPlatformAudit(data as PlatformErrorAuditResult);
    } catch {
      setPlatformError("Erro de rede na auditoria platform-wide");
      setPlatformAudit(null);
    } finally {
      setPlatformLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-ig-border bg-ig-elevated p-4">
        <p className="text-sm font-semibold text-ig-text">Modo de auditoria</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setAuditMode("owner")}
            className={`rounded-lg px-4 py-2 text-sm font-medium transition ${
              auditMode === "owner"
                ? "bg-ig-accent text-white"
                : "border border-ig-border text-ig-muted hover:text-ig-text"
            }`}
          >
            Owner atual
          </button>
          <button
            type="button"
            onClick={() => setAuditMode("platform")}
            className={`rounded-lg px-4 py-2 text-sm font-medium transition ${
              auditMode === "platform"
                ? "bg-ig-accent text-white"
                : "border border-ig-border text-ig-muted hover:text-ig-text"
            }`}
          >
            Plataforma inteira
          </button>
        </div>
        {auditMode === "platform" && (
          <div className="mt-4 space-y-3">
            <p className="text-xs text-ig-muted">
              Busca contas e erros em todos os owner_id (somente leitura). Use para localizar contas
              em outra sessão/workspace.
            </p>
            <form
              className="flex flex-wrap gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                void runPlatformAudit(platformSearch);
              }}
            >
              <input
                value={platformSearch}
                onChange={(e) => setPlatformSearch(e.target.value)}
                placeholder="Buscar conta (ex: arquivoscuriosos3s)"
                className="min-w-[240px] flex-1 rounded-xl border border-ig-border bg-ig-bg px-4 py-2 text-sm"
              />
              <button
                type="submit"
                disabled={platformLoading}
                className="rounded-xl bg-ig-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
              >
                {platformLoading ? "Buscando…" : "Auditar plataforma"}
              </button>
              <button
                type="button"
                disabled={platformLoading}
                onClick={() => void runPlatformAudit()}
                className="rounded-xl border border-ig-border px-4 py-2 text-sm hover:bg-ig-secondary disabled:opacity-50"
              >
                Todas as contas
              </button>
            </form>
            {platformError && (
              <p className="text-sm text-ig-danger">{platformError}</p>
            )}
            {platformAudit && (
              <div className="space-y-3 rounded-xl border border-ig-border bg-ig-bg p-4 text-sm">
                <p className="font-medium text-ig-text">
                  {platformAudit.summary.matchedAccounts} conta(s) · {platformAudit.summary.totalOwnersScanned}{" "}
                  owner(s) · {platformAudit.summary.failedPosts} falhas · {platformAudit.summary.retryingPosts}{" "}
                  retry
                </p>
                {platformAudit.ownerDivergence.length > 0 && (
                  <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-amber-800 dark:text-amber-200">
                    <p className="font-semibold">Conta em owner divergente</p>
                    {platformAudit.ownerDivergence.map((item) => (
                      <p key={`${item.accountId}-${item.foundInOwnerId}`} className="mt-1 text-xs">
                        {item.account} → owner {item.foundInOwnerId.slice(0, 8)}… ·{" "}
                        {item.recommendation}
                      </p>
                    ))}
                  </div>
                )}
                <div className="space-y-2">
                  {platformAudit.matchedAccounts.map((account) => (
                    <div
                      key={`${account.platform}-${account.accountId}`}
                      className="rounded-lg border border-ig-border px-3 py-2"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-medium text-ig-text">
                          {account.account} · {account.platform}
                        </span>
                        <span className="text-xs text-ig-muted">
                          owner {account.ownerEmailMasked}
                          {!account.currentOwnerCanSee ? " · outro owner" : ""}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-ig-muted">
                        failed {account.failed} · retry {account.retrying} · pending {account.pending}
                        {account.lastError ? ` · ${account.lastError}` : ""}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </section>

      {auditMode === "owner" && (
        <>
      <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <ShieldAlert className="text-ig-accent" size={24} />
            <h1 className="text-2xl font-bold text-ig-text">Diagnóstico Admin</h1>
          </div>
          <p className="mt-1 max-w-2xl text-sm text-ig-muted">
            Monitoramento contínuo em modo somente leitura. Valide resoluções com checagem real —
            nada é marcado como resolvido sem confirmar no banco.
          </p>
        </div>
        <div className="relative">
          <button
            type="button"
            onClick={() => setRunMenuOpen((v) => !v)}
            disabled={loading}
            className="ig-btn-secondary inline-flex items-center gap-2 self-start"
          >
            {loading ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
            Reexecutar auditoria
            <ChevronDown size={14} />
          </button>
          {runMenuOpen && (
            <div className="absolute right-0 z-10 mt-1 min-w-[220px] rounded-xl border border-ig-border bg-ig-surface py-1 shadow-lg">
              {[
                { label: "Tudo (completa)", tier: "full" as const },
                { label: "Apenas TikTok", scope: "tiktok" as const, tier: "full" as const },
                { label: "Apenas Instagram", scope: "instagram" as const, tier: "full" as const },
                { label: "Agendamentos", scope: "schedule" as const, tier: "schedule" as const },
                { label: "Publicador/Cron", scope: "publisher" as const, tier: "critical" as const },
                { label: "Uploads", scope: "uploads" as const, tier: "schedule" as const },
                { label: "Checks críticos", tier: "critical" as const },
              ].map((opt) => (
                <button
                  key={opt.label}
                  type="button"
                  className="block w-full px-4 py-2 text-left text-sm hover:bg-ig-nav-hover"
                  onClick={() => {
                    setRunMenuOpen(false);
                    if (opt.scope) setScope(opt.scope);
                    void load(opt.scope ?? scope, opt.tier);
                  }}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </header>

      {sweepMeta && (
        <div className="rounded-xl border border-ig-border bg-ig-surface p-4 text-sm">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <div>
              <p className="text-xs uppercase text-ig-muted">Última varredura</p>
              <p className="font-medium text-ig-text">{formatWhen(lastSweep)}</p>
            </div>
            <div>
              <p className="text-xs uppercase text-ig-muted">Próxima (críticos)</p>
              <p className="font-medium text-ig-text">{relativeNext(sweepMeta.nextCriticalSweepAt)}</p>
            </div>
            <div>
              <p className="text-xs uppercase text-ig-muted">Erros abertos</p>
              <p className="text-xl font-bold text-red-400">{sweepMeta.openCount}</p>
            </div>
            <div>
              <p className="text-xs uppercase text-ig-muted">Resolvidos hoje</p>
              <p className="text-xl font-bold text-emerald-400">{sweepMeta.resolvedTodayCount}</p>
            </div>
            <div>
              <p className="text-xs uppercase text-ig-muted">Reabertos</p>
              <p className="text-xl font-bold text-orange-400">{sweepMeta.reopenedCount}</p>
            </div>
          </div>
          <p className="mt-2 text-xs text-ig-muted">
            Automático: críticos ~5 min · agendamento ~15 min via{" "}
            <code className="rounded bg-ig-bg px-1">/api/admin/audit/cron</code>
          </p>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 border-b border-ig-border pb-2">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setScope(tab.id)}
            className={`rounded-lg px-3 py-1.5 text-sm transition ${
              scope === tab.id
                ? "bg-ig-accent text-white"
                : "text-ig-muted hover:bg-ig-nav-hover hover:text-ig-text"
            }`}
          >
            {tab.label}
          </button>
        ))}
        <label className="ml-auto flex items-center gap-2 text-xs text-ig-muted">
          <input
            type="checkbox"
            checked={showResolved}
            onChange={(e) => {
              setShowResolved(e.target.checked);
              void loadFindings(scope, e.target.checked);
            }}
          />
          Mostrar resolvidos/ignorados
        </label>
      </div>

      {scope !== "overview" && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-800 dark:text-amber-200">
          Escopo <strong>{scope}</strong> — achados de outras plataformas/contas podem estar ocultos.
          Use <button type="button" className="font-medium underline" onClick={() => setScope("overview")}>Visão Geral</button> para auditoria completa do workspace.
        </div>
      )}

      {error && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-300">
          {error}
        </div>
      )}

      {summary && !loading && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-xl border border-ig-border bg-ig-surface p-4">
            <p className="text-xs uppercase text-ig-muted">Críticos</p>
            <p className="text-2xl font-bold text-red-400">{summary.critical}</p>
          </div>
          <div className="rounded-xl border border-ig-border bg-ig-surface p-4">
            <p className="text-xs uppercase text-ig-muted">Altos</p>
            <p className="text-2xl font-bold text-orange-400">{summary.high}</p>
          </div>
          <div className="rounded-xl border border-ig-border bg-ig-surface p-4">
            <p className="text-xs uppercase text-ig-muted">Contas com problema</p>
            <p className="text-2xl font-bold text-ig-text">{summary.accountsWithProblems}</p>
          </div>
          <div className="rounded-xl border border-ig-border bg-ig-surface p-4">
            <p className="text-xs uppercase text-ig-muted">Contas saudáveis</p>
            <p className="text-2xl font-bold text-emerald-400">{summary.healthyAccounts}</p>
          </div>
        </div>
      )}

      {loading && (
        <div className="flex items-center justify-center py-16 text-ig-muted">
          <Loader2 size={28} className="animate-spin" />
        </div>
      )}

      {!loading && (
        <div className="space-y-3">
          <p className="text-sm text-ig-muted">
            {displayFindings.length} achado(s) · escopo: {scope}
            {result?.ranAt && ` · varredura ${formatWhen(result.ranAt)}`}
          </p>
          {displayFindings.length === 0 ? (
            <p className="flex items-center justify-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-6 text-center text-emerald-300">
              <CheckCircle2 size={20} />
              Nenhum problema aberto neste escopo.
            </p>
          ) : (
            displayFindings.map((finding) => (
              <FindingCard
                key={finding.fingerprint}
                finding={finding}
                onValidate={validateFinding}
                onIgnore={ignoreFinding}
                validating={validatingId === finding.fingerprint}
                validationMessage={validationMessages[finding.fingerprint]}
              />
            ))
          )}
        </div>
      )}
        </>
      )}
    </div>
  );
}
