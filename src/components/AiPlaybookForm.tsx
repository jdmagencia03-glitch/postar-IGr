"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  Copy,
  Download,
  Loader2,
  RefreshCw,
  Save,
  Search,
  Sparkles,
  Upload,
  UserRound,
} from "lucide-react";
import {
  AVOID_OPTIONS,
  applyProfileImport,
  accountPageLabel,
  buildPreviewCaption,
  CTA_PRIORITY_OPTIONS,
  DEFAULT_CONTENT_FORM,
  EMOJI_OPTIONS,
  GOAL_OPTIONS,
  LENGTH_OPTIONS,
  NICHE_OPTIONS,
  NICHE_TEMPLATES,
  TONE_OPTIONS,
  type ConnectedAccountOption,
  type ContentAssistantForm,
  type EmojiOption,
  type GoalOption,
  type LengthOption,
  type NicheOption,
  type ToneOption,
  contentFormToPlaybook,
  playbookToContentForm,
  resolveSelectedAccountId,
  syncFormWithAccount,
} from "@/lib/ai/content-assistant-form";

function SectionCard({
  step,
  title,
  description,
  children,
  highlight,
}: {
  step?: string;
  title: string;
  description?: string;
  children: React.ReactNode;
  highlight?: boolean;
}) {
  return (
    <section
      className={`space-y-4 p-5 ${highlight ? "ig-hero border-ig-info-border" : "ig-panel"}`}
    >
      <div>
        {step && (
          <p className="text-xs font-semibold uppercase tracking-wide text-ig-primary">{step}</p>
        )}
        <h2 className="text-lg font-semibold text-ig-text">{title}</h2>
        {description && <p className="mt-1 text-sm text-ig-muted">{description}</p>}
      </div>
      {children}
    </section>
  );
}

function ChipButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-3 py-1.5 text-sm font-medium transition ${
        active
          ? "border-ig-primary bg-ig-primary text-ig-on-primary"
          : "border-ig-border bg-ig-elevated text-ig-text hover:bg-ig-secondary"
      }`}
    >
      {children}
    </button>
  );
}

function RadioChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-3 py-1.5 text-sm transition ${
        active
          ? "border-ig-primary bg-ig-primary/10 font-semibold text-ig-text"
          : "border-ig-border bg-ig-elevated text-ig-muted hover:bg-ig-secondary"
      }`}
    >
      {active ? "● " : "○ "}
      {children}
    </button>
  );
}

const TEMPLATE_KEYS = ["Fitness", "Beleza", "Moda", "Relacionamento", "Humor", "Negócios", "Pets"] as const;

export function AiPlaybookForm() {
  const [form, setForm] = useState<ContentAssistantForm>({
    ...DEFAULT_CONTENT_FORM,
    examples: [...DEFAULT_CONTENT_FORM.examples],
    tones: [...DEFAULT_CONTENT_FORM.tones],
    avoid: [...DEFAULT_CONTENT_FORM.avoid],
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [importingProfile, setImportingProfile] = useState(false);
  const [importingCaptions, setImportingCaptions] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewCaption, setPreviewCaption] = useState(buildPreviewCaption(DEFAULT_CONTENT_FORM));
  const [previewSeed, setPreviewSeed] = useState(0);
  const [configured, setConfigured] = useState(false);
  const [saved, setSaved] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [accounts, setAccounts] = useState<ConnectedAccountOption[]>([]);
  const [accountsLoading, setAccountsLoading] = useState(true);
  const [accountSearch, setAccountSearch] = useState("");
  const importInputRef = useRef<HTMLInputElement>(null);

  const filteredAccounts = useMemo(() => {
    const query = accountSearch.trim().toLowerCase();
    if (!query) return accounts;

    return accounts.filter((account) => {
      const username = account.ig_username?.toLowerCase() ?? "";
      const label = accountPageLabel(account).toLowerCase();
      return username.includes(query) || label.includes(query);
    });
  }, [accounts, accountSearch]);

  const generatePreview = useCallback(async (currentForm: ContentAssistantForm, seed: number) => {
    setPreviewLoading(true);
    try {
      const res = await fetch("/api/ai/playbook/preview", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...currentForm, seed }),
      });
      const data = await res.json();
      if (res.ok && data.caption) {
        setPreviewCaption(data.caption);
      } else {
        setPreviewCaption(buildPreviewCaption(currentForm, seed));
      }
    } catch {
      setPreviewCaption(buildPreviewCaption(currentForm, seed));
    } finally {
      setPreviewLoading(false);
    }
  }, []);

  const fetchPlaybook = useCallback(async () => {
    setLoading(true);
    setAccountsLoading(true);
    try {
      const [playbookRes, accountsRes] = await Promise.all([
        fetch("/api/ai/playbook", { credentials: "include", cache: "no-store" }),
        fetch("/api/accounts", { credentials: "include", cache: "no-store" }),
      ]);

      const data = await playbookRes.json();
      if (!playbookRes.ok) throw new Error(data.error ?? "Falha ao carregar");

      const accountList = accountsRes.ok
        ? ((await accountsRes.json()) as ConnectedAccountOption[])
        : [];

      const loaded = playbookToContentForm(data);
      const selectedId = resolveSelectedAccountId(loaded, accountList);
      const selectedAccount = accountList.find((account) => account.id === selectedId);
      const synced = selectedAccount ? syncFormWithAccount(loaded, selectedAccount) : loaded;

      setAccounts(accountList);
      setForm(synced);
      setConfigured(Boolean(data.configured));
      await generatePreview(synced, 0);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Erro ao carregar configuração");
    } finally {
      setLoading(false);
      setAccountsLoading(false);
    }
  }, [generatePreview]);

  useEffect(() => {
    fetchPlaybook();
  }, [fetchPlaybook]);

  function updateField<K extends keyof ContentAssistantForm>(key: K, value: ContentAssistantForm[K]) {
    setForm((current) => ({ ...current, [key]: value }));
    setSaved(false);
  }

  function toggleTone(tone: ToneOption) {
    setForm((current) => {
      const exists = current.tones.includes(tone);
      const tones = exists
        ? current.tones.filter((item) => item !== tone)
        : [...current.tones, tone];
      return { ...current, tones: tones.length ? tones : [tone] };
    });
    setSaved(false);
  }

  function toggleAvoid(item: string) {
    setForm((current) => {
      const exists = current.avoid.includes(item);
      const avoid = exists ? current.avoid.filter((a) => a !== item) : [...current.avoid, item];
      return { ...current, avoid };
    });
    setSaved(false);
  }

  function updateExample(index: number, value: string) {
    setForm((current) => {
      const examples = [...current.examples] as ContentAssistantForm["examples"];
      examples[index] = value;
      return { ...current, examples };
    });
    setSaved(false);
  }

  function selectAccount(account: ConnectedAccountOption) {
    setForm((current) => syncFormWithAccount(current, account));
    setSaved(false);
  }

  async function handleImportProfile() {
    if (!form.selectedAccountId) {
      setMessage("Selecione uma página antes de importar.");
      return;
    }

    setImportingProfile(true);
    setMessage(null);
    try {
      const res = await fetch("/api/ai/playbook/import-profile", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountId: form.selectedAccountId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Falha ao importar perfil");

      setForm((current) => applyProfileImport(current, data.snapshot));
      setMessage("Perfil importado com sucesso.");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Erro ao importar perfil");
    } finally {
      setImportingProfile(false);
    }
  }

  async function handleImportCaptions() {
    if (!form.selectedAccountId) {
      setMessage("Selecione uma página antes de importar.");
      return;
    }

    setImportingCaptions(true);
    setMessage(null);
    try {
      const res = await fetch("/api/ai/playbook/import-captions", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountId: form.selectedAccountId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Falha ao importar legendas");

      const examples = [...form.examples] as ContentAssistantForm["examples"];
      (data.captions as string[]).slice(0, 5).forEach((caption: string, i: number) => {
        examples[i] = caption;
      });
      setForm((current) => ({ ...current, examples }));
      setMessage("Legendas importadas do Instagram.");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Erro ao importar legendas");
    } finally {
      setImportingCaptions(false);
    }
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setMessage(null);

    try {
      const res = await fetch("/api/ai/playbook", {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(contentFormToPlaybook(form)),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Falha ao salvar");

      setConfigured(Boolean(data.configured));
      setSaved(true);
      setMessage("✓ Configuração salva com sucesso");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Erro ao salvar");
    } finally {
      setSaving(false);
    }
  }

  function applyTemplate(key: (typeof TEMPLATE_KEYS)[number]) {
    const template = NICHE_TEMPLATES[key];
    if (!template) return;
    setForm((current) => ({
      ...current,
      ...template,
      examples: (template.examples ?? current.examples) as ContentAssistantForm["examples"],
      tones: (template.tones ?? current.tones) as ContentAssistantForm["tones"],
    }));
    setMessage(`Modelo ${key} aplicado. Revise e salve.`);
    setSaved(false);
  }

  function restoreDefault() {
    setForm({
      ...DEFAULT_CONTENT_FORM,
      examples: [...DEFAULT_CONTENT_FORM.examples],
      tones: [...DEFAULT_CONTENT_FORM.tones],
      avoid: [...DEFAULT_CONTENT_FORM.avoid],
    });
    setMessage("Configuração padrão restaurada.");
    setSaved(false);
  }

  function exportConfig() {
    const blob = new Blob([JSON.stringify(form, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `estilo-pagina-${form.pageName || "config"}.json`;
    link.click();
    URL.revokeObjectURL(url);
    setMessage("Configuração exportada.");
  }

  async function duplicateConfig() {
    try {
      await navigator.clipboard.writeText(JSON.stringify(form, null, 2));
      setMessage("Configuração copiada. Cole em outro perfil ou salve como backup.");
    } catch {
      setMessage("Não foi possível copiar. Use Exportar.");
    }
  }

  function handleImportFile(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result)) as Partial<ContentAssistantForm>;
        setForm({
          ...DEFAULT_CONTENT_FORM,
          ...parsed,
          examples: (parsed.examples ?? DEFAULT_CONTENT_FORM.examples) as ContentAssistantForm["examples"],
          tones: (parsed.tones ?? DEFAULT_CONTENT_FORM.tones) as ContentAssistantForm["tones"],
          avoid: parsed.avoid ?? [...DEFAULT_CONTENT_FORM.avoid],
        });
        setMessage("Configuração importada. Revise e salve.");
        setSaved(false);
      } catch {
        setMessage("Arquivo inválido. Use um JSON exportado desta página.");
      }
    };
    reader.readAsText(file);
  }

  if (loading) {
    return (
      <div className="ig-panel p-8 text-center text-ig-muted">
        Carregando assistente de conteúdo...
      </div>
    );
  }

  return (
    <form onSubmit={handleSave} className="space-y-6">
      <div className="ig-hero p-5">
        <div className="flex items-start gap-3">
          <Sparkles className="mt-1 shrink-0 text-ig-primary" size={24} />
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-ig-primary">
              Assistente de Conteúdo
            </p>
            <h1 className="text-xl font-bold text-ig-text">
              Personalize como a IA cria suas legendas
            </h1>
            <p className="mt-1 text-sm text-ig-muted">
              A IA usará estas informações para criar legendas, hashtags e CTAs alinhados com sua
              página.
            </p>
          </div>
        </div>
      </div>

      <SectionCard
        step="Seção 1"
        title="Importar do Instagram"
        description="Conecte sua página e deixe a IA analisar automaticamente: bio, nome, tipo de conteúdo, linguagem, hashtags e temas."
        highlight
      >
        <ul className="grid gap-1 text-sm text-ig-muted sm:grid-cols-2">
          {["Bio", "Nome do perfil", "Tipo de conteúdo", "Linguagem utilizada", "Hashtags frequentes", "Temas principais"].map(
            (item) => (
              <li key={item} className="flex items-center gap-2">
                <Check size={14} className="text-ig-primary" />
                {item}
              </li>
            ),
          )}
        </ul>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={handleImportProfile}
            disabled={importingProfile}
            className="ig-btn flex items-center gap-2 px-4 py-2 text-sm disabled:opacity-50"
          >
            {importingProfile ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <UserRound size={16} />
            )}
            Importar Perfil
          </button>
          <button
            type="button"
            onClick={handleImportProfile}
            disabled={importingProfile}
            className="ig-btn-secondary flex items-center gap-2 px-4 py-2 text-sm disabled:opacity-50"
          >
            <RefreshCw size={16} />
            Atualizar Dados
          </button>
        </div>

        {form.profileImported && (
          <p className="flex items-center gap-2 text-sm text-ig-text">
            <Check size={16} className="text-ig-primary" />
            Perfil analisado
          </p>
        )}
      </SectionCard>

      <SectionCard step="Seção 2" title="Sobre sua página">
        <div>
          <label className="mb-1 block text-sm font-medium text-ig-text">Nome da Página</label>
          <p className="mb-3 text-xs text-ig-muted">
            Escolha uma das suas contas conectadas para personalizar as legendas.
          </p>

          {accounts.length > 0 && (
            <div className="relative mb-3">
              <Search
                size={16}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ig-muted"
              />
              <input
                type="search"
                value={accountSearch}
                onChange={(e) => setAccountSearch(e.target.value)}
                placeholder="Pesquisar página..."
                className="ig-input w-full pl-9"
              />
            </div>
          )}

          {accountsLoading ? (
            <div className="flex items-center gap-2 rounded-lg border border-ig-border bg-ig-secondary px-4 py-3 text-sm text-ig-muted">
              <Loader2 size={16} className="animate-spin" />
              Carregando contas...
            </div>
          ) : accounts.length === 0 ? (
            <div className="rounded-lg border border-ig-border bg-ig-secondary px-4 py-4 text-sm text-ig-muted">
              <p>Nenhuma conta conectada.</p>
              <a href="/dashboard/accounts" className="mt-2 inline-block text-ig-primary hover:underline">
                Conectar conta do Instagram
              </a>
            </div>
          ) : filteredAccounts.length === 0 ? (
            <p className="rounded-lg border border-ig-border bg-ig-secondary px-4 py-3 text-sm text-ig-muted">
              Nenhuma página encontrada para &quot;{accountSearch}&quot;.
            </p>
          ) : (
            <div className="max-h-64 space-y-2 overflow-y-auto pr-1">
              {filteredAccounts.map((account) => {
                const selected = form.selectedAccountId === account.id;
                return (
                  <button
                    key={account.id}
                    type="button"
                    onClick={() => selectAccount(account)}
                    className={`flex w-full items-center gap-3 rounded-xl border px-3 py-3 text-left transition ${
                      selected
                        ? "border-ig-primary bg-ig-primary/10"
                        : "border-ig-border bg-ig-elevated hover:bg-ig-secondary"
                    }`}
                  >
                    {account.profile_picture_url ? (
                      <img
                        src={account.profile_picture_url}
                        alt=""
                        className="h-10 w-10 shrink-0 rounded-full object-cover"
                      />
                    ) : (
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-ig-secondary text-ig-muted">
                        <UserRound size={18} />
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium text-ig-text">{accountPageLabel(account)}</p>
                      <p className="truncate text-xs text-ig-muted">Conta conectada</p>
                    </div>
                    {selected && <Check size={18} className="shrink-0 text-ig-primary" />}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-ig-text">Nicho</label>
          <select
            value={form.niche}
            onChange={(e) => updateField("niche", e.target.value as NicheOption)}
            className="ig-input w-full"
          >
            {NICHE_OPTIONS.map((niche) => (
              <option key={niche} value={niche}>
                {niche}
              </option>
            ))}
          </select>
        </div>

        <div>
          <p className="mb-2 text-sm font-medium text-ig-text">Objetivo Principal</p>
          <div className="flex flex-wrap gap-2">
            {GOAL_OPTIONS.map((goal) => (
              <RadioChip
                key={goal}
                active={form.primaryGoal === goal}
                onClick={() => updateField("primaryGoal", goal as GoalOption)}
              >
                {goal}
              </RadioChip>
            ))}
          </div>
        </div>
      </SectionCard>

      <SectionCard step="Seção 3" title="Como a IA deve escrever">
        <div>
          <p className="mb-2 text-sm font-medium text-ig-text">Tom de Voz</p>
          <div className="flex flex-wrap gap-2">
            {TONE_OPTIONS.map((tone) => (
              <ChipButton
                key={tone}
                active={form.tones.includes(tone)}
                onClick={() => toggleTone(tone)}
              >
                {form.tones.includes(tone) ? "☑ " : "☐ "}
                {tone}
              </ChipButton>
            ))}
          </div>
        </div>

        <div>
          <p className="mb-2 text-sm font-medium text-ig-text">Quantidade de Emojis</p>
          <div className="flex flex-wrap gap-2">
            {EMOJI_OPTIONS.map((level) => (
              <RadioChip
                key={level}
                active={form.emojiLevel === level}
                onClick={() => updateField("emojiLevel", level as EmojiOption)}
              >
                {level}
              </RadioChip>
            ))}
          </div>
        </div>

        <div>
          <p className="mb-2 text-sm font-medium text-ig-text">Tamanho da Legenda</p>
          <div className="flex flex-wrap gap-2">
            {LENGTH_OPTIONS.map((size) => (
              <RadioChip
                key={size}
                active={form.captionLength === size}
                onClick={() => updateField("captionLength", size as LengthOption)}
              >
                {size}
              </RadioChip>
            ))}
          </div>
        </div>
      </SectionCard>

      <SectionCard
        step="Seção 4"
        title="Ensine a IA com exemplos"
        description="Cole até 5 legendas que representam bem sua página."
      >
        <div className="space-y-3">
          {form.examples.map((example, index) => (
            <div key={index}>
              <label className="mb-1 block text-xs font-medium text-ig-muted">
                Legenda {index + 1}
              </label>
              <textarea
                value={example}
                onChange={(e) => updateExample(index, e.target.value)}
                rows={3}
                placeholder={`Legenda ${index + 1}`}
                className="w-full rounded-lg border border-ig-border bg-ig-elevated px-3 py-2 text-sm text-ig-text focus:border-ig-primary focus:outline-none focus:ring-2 focus:ring-ig-primary/20"
              />
            </div>
          ))}
        </div>

        <button
          type="button"
          onClick={handleImportCaptions}
          disabled={importingCaptions}
          className="ig-btn-secondary flex items-center gap-2 px-4 py-2 text-sm disabled:opacity-50"
        >
          {importingCaptions ? (
            <Loader2 size={16} className="animate-spin" />
          ) : (
            <UserRound size={16} />
          )}
          Importar Legendas do Instagram
        </button>
      </SectionCard>

      <SectionCard step="Seção 5" title="O que evitar">
        <div className="flex flex-wrap gap-2">
          {AVOID_OPTIONS.map((item) => (
            <ChipButton key={item} active={form.avoid.includes(item)} onClick={() => toggleAvoid(item)}>
              {form.avoid.includes(item) ? "☑ " : "☐ "}
              {item}
            </ChipButton>
          ))}
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-ig-text">Outras observações</label>
          <textarea
            value={form.avoidNotes}
            onChange={(e) => updateField("avoidNotes", e.target.value)}
            rows={3}
            placeholder="Opcional — algo que a IA deve evitar nas suas legendas"
            className="w-full rounded-lg border border-ig-border bg-ig-elevated px-3 py-2 text-sm text-ig-text focus:border-ig-primary focus:outline-none focus:ring-2 focus:ring-ig-primary/20"
          />
        </div>
      </SectionCard>

      <SectionCard step="Seção 6" title="Configuração de CTA">
        <p className="text-sm text-ig-muted">A IA deve priorizar:</p>
        <div className="flex flex-wrap gap-2">
          {CTA_PRIORITY_OPTIONS.map((cta) => (
            <RadioChip
              key={cta}
              active={form.ctaPriority === cta}
              onClick={() => updateField("ctaPriority", cta)}
            >
              {cta}
            </RadioChip>
          ))}
        </div>
      </SectionCard>

      <section className="ig-panel space-y-4 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-ig-primary">
              Prévia em tempo real
            </p>
            <p className="text-sm text-ig-muted">Exemplo de legenda com suas configurações.</p>
          </div>
          <button
            type="button"
            onClick={() => {
              const nextSeed = previewSeed + 1;
              setPreviewSeed(nextSeed);
              generatePreview(form, nextSeed);
            }}
            disabled={previewLoading}
            className="ig-btn-secondary flex items-center gap-2 px-3 py-2 text-sm disabled:opacity-50"
          >
            {previewLoading ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <RefreshCw size={16} />
            )}
            Gerar Nova Prévia
          </button>
        </div>

        <div className="rounded-xl border border-ig-border bg-ig-secondary p-4 text-sm whitespace-pre-wrap text-ig-text">
          {previewLoading ? "Gerando prévia..." : previewCaption}
        </div>
      </section>

      <section className="ig-panel flex items-start gap-3 p-5">
        <span className="mt-0.5 text-lg" aria-hidden>
          🟢
        </span>
        <div>
          <p className="font-semibold text-ig-text">IA ativa</p>
          <p className="text-sm text-ig-muted">
            {configured || saved
              ? "A IA está pronta para gerar legendas para sua página."
              : "Salve a configuração para ativar o estilo personalizado nas próximas legendas."}
          </p>
        </div>
      </section>

      <section className="ig-panel space-y-3 p-5">
        <p className="text-xs font-semibold uppercase tracking-wide text-ig-primary">Ferramentas</p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={duplicateConfig}
            className="ig-btn-secondary flex items-center gap-2 px-3 py-2 text-sm"
          >
            <Copy size={14} />
            Duplicar
          </button>
          <button
            type="button"
            onClick={exportConfig}
            className="ig-btn-secondary flex items-center gap-2 px-3 py-2 text-sm"
          >
            <Download size={14} />
            Exportar
          </button>
          <button
            type="button"
            onClick={() => importInputRef.current?.click()}
            className="ig-btn-secondary flex items-center gap-2 px-3 py-2 text-sm"
          >
            <Upload size={14} />
            Importar
          </button>
          <button
            type="button"
            onClick={restoreDefault}
            className="ig-btn-secondary px-3 py-2 text-sm"
          >
            Restaurar padrão
          </button>
          <input
            ref={importInputRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleImportFile(file);
              e.target.value = "";
            }}
          />
        </div>

        <div>
          <p className="mb-2 text-sm font-medium text-ig-text">Templates por nicho</p>
          <div className="flex flex-wrap gap-2">
            {TEMPLATE_KEYS.map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => applyTemplate(key)}
                className="rounded-full border border-ig-border bg-ig-elevated px-3 py-1.5 text-sm text-ig-text hover:bg-ig-secondary"
              >
                {key}
              </button>
            ))}
          </div>
        </div>
      </section>

      <button
        type="submit"
        disabled={saving}
        className="ig-btn flex w-full items-center justify-center gap-2 px-4 py-3 disabled:opacity-50"
      >
        <Save size={16} />
        {saving ? "Salvando..." : "Salvar Configuração"}
      </button>

      {saved && (
        <p className="text-sm text-ig-text">
          ✓ Configuração salva com sucesso
          <br />
          <span className="text-ig-muted">
            A partir de agora todas as novas legendas seguirão estas configurações.
          </span>
        </p>
      )}

      {message && !saved && (
        <p
          className={`text-sm ${
            message.startsWith("✓") || message.includes("sucesso") || message.includes("importad")
              ? "text-ig-text"
              : "text-ig-danger"
          }`}
        >
          {message}
        </p>
      )}
    </form>
  );
}
