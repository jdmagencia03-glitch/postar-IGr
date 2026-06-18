"use client";

import type { ReportFilters } from "@/lib/operations/filters";
import { buildReportQuery } from "@/lib/operations/filters";
import type { SocialPlatform, ContentType } from "@/lib/types";

interface AccountOption {
  id: string;
  platform: SocialPlatform;
  ig_username: string | null;
}

interface Props {
  filters: ReportFilters;
  accounts: AccountOption[];
  products?: Array<{ id: string; name: string }>;
  campaigns?: Array<{ id: string; name: string }>;
}

function FilterLink({
  label,
  active,
  href,
}: {
  label: string;
  active: boolean;
  href: string;
}) {
  return (
    <a
      href={href}
      className={`rounded-full px-3 py-1.5 text-xs transition ${
        active
          ? "bg-ig-primary text-ig-on-primary"
          : "border border-ig-border bg-ig-elevated text-ig-text hover:bg-ig-secondary"
      }`}
    >
      {label}
    </a>
  );
}

export function ReportFiltersBar({ filters, accounts, products = [], campaigns = [] }: Props) {
  const base = (patch: Partial<ReportFilters>) =>
    buildReportQuery({ ...filters, ...patch });

  const visibleAccounts = accounts.filter(
    (a) => filters.platform === "all" || a.platform === filters.platform,
  );

  return (
    <section className="space-y-4 rounded-2xl border border-ig-border bg-ig-elevated p-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-ig-text">Filtros avançados</h3>
          <p className="text-xs text-ig-muted">Combine filtros para refinar a lista.</p>
        </div>
        <a href="/dashboard/reports" className="text-xs text-ig-primary hover:underline">
          Limpar filtros
        </a>
      </div>

      <form action="/dashboard/reports" method="get" className="flex flex-wrap gap-2">
        <input type="hidden" name="platform" value={filters.platform !== "all" ? filters.platform : ""} />
        <input
          type="hidden"
          name="content_type"
          value={filters.contentType !== "all" ? filters.contentType : ""}
        />
        <input type="hidden" name="account" value={filters.accountId ?? ""} />
        <input type="hidden" name="status" value={filters.status !== "all" ? filters.status : ""} />
        <input type="hidden" name="period" value={filters.period !== "all" ? filters.period : ""} />
        <input type="hidden" name="quick" value={filters.quick ?? ""} />
        <input type="hidden" name="view" value={filters.view} />
        <input
          name="q"
          defaultValue={filters.q ?? ""}
          placeholder="Buscar conta, legenda, erro…"
          className="ig-input min-w-[220px] flex-1 text-sm"
        />
        <select name="sort" defaultValue={filters.sort} className="ig-input text-sm">
          <option value="scheduled_at">Data de agendamento</option>
          <option value="created_at">Data de criação</option>
          <option value="status">Status</option>
          <option value="platform">Plataforma</option>
          <option value="account">Conta</option>
          <option value="error_recent">Erro mais recente</option>
          <option value="next_retry">Próximo retry</option>
        </select>
        <select name="sort_dir" defaultValue={filters.sortDir} className="ig-input text-sm">
          <option value="desc">Mais recente</option>
          <option value="asc">Mais antigo</option>
        </select>
        <button type="submit" className="ig-btn px-4 py-2 text-sm">
          Buscar
        </button>
      </form>

      <div className="flex flex-wrap gap-2">
        <span className="self-center text-xs font-medium text-ig-muted">Plataforma:</span>
        {(
          [
            ["all", "Todas"],
            ["instagram", "Instagram"],
            ["tiktok", "TikTok"],
          ] as const
        ).map(([value, label]) => (
          <FilterLink
            key={value}
            label={label}
            active={filters.platform === value}
            href={base({ platform: value as SocialPlatform | "all" })}
          />
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        <span className="self-center text-xs font-medium text-ig-muted">Tipo:</span>
        {(
          [
            ["all", "Todos"],
            ["reel", "Reels"],
            ["post", "Posts"],
            ["story", "Stories"],
            ["tiktok_video", "TikTok Videos"],
          ] as const
        ).map(([value, label]) => (
          <FilterLink
            key={value}
            label={label}
            active={filters.contentType === value}
            href={base({ contentType: value as ContentType | "all" })}
          />
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        <span className="self-center text-xs font-medium text-ig-muted">Status:</span>
        {(
          [
            ["all", "Todos"],
            ["pending", "Pendentes"],
            ["retrying", "Em retry"],
            ["processing", "Publicando"],
            ["published", "Publicados"],
            ["failed", "Falhas"],
            ["failed_persistent", "Falha persistente"],
            ["cancelled", "Cancelados"],
          ] as const
        ).map(([value, label]) => (
          <FilterLink
            key={value}
            label={label}
            active={filters.status === value}
            href={base({ status: value as ReportFilters["status"] })}
          />
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        <span className="self-center text-xs font-medium text-ig-muted">Atalhos:</span>
        {(
          [
            ["published_today", "Publicados hoje"],
            ["scheduled_today", "Agendados hoje"],
            ["next_7_days", "Próximos 7 dias"],
            ["last_7_days", "Últimos 7 dias"],
            ["multiplatform", "Multiplataforma"],
            ["grouped_only", "Agrupados"],
            ["single_only", "Individuais"],
            ["with_error", "Com erro"],
            ["without_error", "Sem erro"],
          ] as const
        ).map(([value, label]) => (
          <FilterLink
            key={value}
            label={label}
            active={filters.quick === value}
            href={base({ quick: value })}
          />
        ))}
      </div>

      {visibleAccounts.length > 1 && (
        <div className="flex flex-wrap gap-2">
          <span className="self-center text-xs font-medium text-ig-muted">Conta:</span>
          <FilterLink
            label="Todas"
            active={!filters.accountId}
            href={base({ accountId: undefined })}
          />
          {visibleAccounts.map((account) => (
            <FilterLink
              key={account.id}
              label={`${account.platform === "tiktok" ? "TT" : "IG"} @${account.ig_username ?? "conta"}`}
              active={filters.accountId === account.id}
              href={base({ accountId: account.id, platform: account.platform })}
            />
          ))}
        </div>
      )}

      {(products.length > 0 || campaigns.length > 0) && (
        <div className="flex flex-wrap gap-4">
          {products.length > 0 && (
            <div className="flex flex-wrap gap-2">
              <span className="self-center text-xs font-medium text-ig-muted">Produto:</span>
              <FilterLink
                label="Todos"
                active={!filters.productId}
                href={base({ productId: undefined })}
              />
              {products.map((product) => (
                <FilterLink
                  key={product.id}
                  label={product.name}
                  active={filters.productId === product.id}
                  href={base({ productId: product.id })}
                />
              ))}
            </div>
          )}
          {campaigns.length > 0 && (
            <div className="flex flex-wrap gap-2">
              <span className="self-center text-xs font-medium text-ig-muted">Campanha:</span>
              <FilterLink
                label="Todas"
                active={!filters.campaignId}
                href={base({ campaignId: undefined })}
              />
              {campaigns.map((campaign) => (
                <FilterLink
                  key={campaign.id}
                  label={campaign.name}
                  active={filters.campaignId === campaign.id}
                  href={base({ campaignId: campaign.id })}
                />
              ))}
            </div>
          )}
        </div>
      )}

      <div className="grid gap-2 sm:grid-cols-2">
        <form action="/dashboard/reports" method="get" className="flex flex-wrap items-center gap-2">
          {filters.platform !== "all" && <input type="hidden" name="platform" value={filters.platform} />}
          {filters.contentType !== "all" && (
            <input type="hidden" name="content_type" value={filters.contentType} />
          )}
          {filters.accountId && <input type="hidden" name="account" value={filters.accountId} />}
          {filters.status !== "all" && <input type="hidden" name="status" value={filters.status} />}
          {filters.quick && <input type="hidden" name="quick" value={filters.quick} />}
          {filters.q && <input type="hidden" name="q" value={filters.q} />}
          <input type="hidden" name="view" value={filters.view} />
          <label className="text-xs text-ig-muted">De</label>
          <input type="date" name="date_from" defaultValue={filters.dateFrom} className="ig-input text-sm" />
          <label className="text-xs text-ig-muted">Até</label>
          <input type="date" name="date_to" defaultValue={filters.dateTo} className="ig-input text-sm" />
          <button type="submit" className="rounded-lg border border-ig-border px-3 py-1.5 text-xs">
            Aplicar datas
          </button>
        </form>
      </div>
    </section>
  );
}
