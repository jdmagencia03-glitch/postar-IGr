import type { AiPlaybook } from "@/lib/types";

export const NICHE_OPTIONS = [
  "Fitness",
  "Beleza",
  "Moda",
  "Relacionamento",
  "Motivação",
  "Humor",
  "Negócios",
  "Educação",
  "Pets",
  "Culinária",
  "Outro",
] as const;

export const GOAL_OPTIONS = [
  "Ganhar seguidores",
  "Gerar comentários",
  "Gerar compartilhamentos",
  "Gerar vendas",
  "Levar pessoas para o link",
  "Fortalecer marca",
] as const;

export const TONE_OPTIONS = [
  "Direto",
  "Motivacional",
  "Educativo",
  "Humor",
  "Profissional",
  "Inspirador",
  "Emocional",
  "Autoridade",
] as const;

export const EMOJI_OPTIONS = ["Poucos", "Médio", "Muitos"] as const;
export const LENGTH_OPTIONS = ["Curta", "Média", "Longa"] as const;

export const CTA_PRIORITY_OPTIONS = [
  "Comentários",
  "Compartilhamentos",
  "Salvamentos",
  "Seguidores",
  "Cliques no link",
] as const;

export const AVOID_OPTIONS = [
  "Linguagem robótica",
  "Promessas exageradas",
  "Muitos emojis",
  "Textos muito longos",
  "Repetir hashtags",
  "Repetir CTAs",
] as const;

export type NicheOption = (typeof NICHE_OPTIONS)[number];
export type GoalOption = (typeof GOAL_OPTIONS)[number];
export type ToneOption = (typeof TONE_OPTIONS)[number];
export type EmojiOption = (typeof EMOJI_OPTIONS)[number];
export type LengthOption = (typeof LENGTH_OPTIONS)[number];
export type CtaPriorityOption = (typeof CTA_PRIORITY_OPTIONS)[number];

export interface ContentAssistantForm {
  pageName: string;
  selectedAccountId: string;
  niche: NicheOption;
  customNiche: string;
  primaryGoal: GoalOption;
  tones: ToneOption[];
  emojiLevel: EmojiOption;
  captionLength: LengthOption;
  examples: [string, string, string, string, string];
  avoid: string[];
  avoidNotes: string;
  ctaPriority: CtaPriorityOption;
  profileImported: boolean;
  profileSummary: string;
}

interface StoredMeta {
  v: 2;
  emojiLevel: EmojiOption;
  captionLength: LengthOption;
  ctaPriority: CtaPriorityOption;
  avoid: string[];
  avoidNotes: string;
  profileImported: boolean;
  profileSummary: string;
  selectedAccountId?: string;
  customNiche?: string;
}

export function resolveFormNiche(form: Pick<ContentAssistantForm, "niche" | "customNiche">) {
  if (form.niche === "Outro") {
    return form.customNiche.trim() || "Outro";
  }
  return form.niche;
}

const META_PREFIX = "__meta_v2__:";

export const DEFAULT_CONTENT_FORM: ContentAssistantForm = {
  pageName: "",
  selectedAccountId: "",
  niche: "Beleza",
  customNiche: "",
  primaryGoal: "Ganhar seguidores",
  tones: ["Direto", "Profissional"],
  emojiLevel: "Médio",
  captionLength: "Média",
  examples: ["", "", "", "", ""],
  avoid: [...AVOID_OPTIONS],
  avoidNotes: "",
  ctaPriority: "Salvamentos",
  profileImported: false,
  profileSummary: "",
};

export const NICHE_TEMPLATES: Record<string, Partial<ContentAssistantForm>> = {
  Fitness: {
    pageName: "De Olho no Shape",
    niche: "Fitness",
    primaryGoal: "Ganhar seguidores",
    tones: ["Direto", "Motivacional", "Educativo"],
    ctaPriority: "Salvamentos",
    examples: [
      "POV: você finalmente achou um treino que cabe na rotina 💪\nSalva pra fazer depois.\n#fitness #treino #shape",
      "",
      "",
      "",
      "",
    ],
  },
  Beleza: {
    niche: "Beleza",
    tones: ["Direto", "Profissional"],
    ctaPriority: "Salvamentos",
  },
  Moda: { niche: "Moda", tones: ["Direto", "Inspirador"], ctaPriority: "Compartilhamentos" },
  Relacionamento: { niche: "Relacionamento", tones: ["Emocional", "Direto"], ctaPriority: "Comentários" },
  Humor: { niche: "Humor", tones: ["Humor", "Direto"], emojiLevel: "Muitos", ctaPriority: "Compartilhamentos" },
  Negócios: { niche: "Negócios", tones: ["Autoridade", "Profissional"], ctaPriority: "Cliques no link" },
  Pets: { niche: "Pets", tones: ["Emocional", "Humor"], ctaPriority: "Comentários" },
};

function encodeMeta(form: ContentAssistantForm, extra?: Partial<StoredMeta>): string {
  const meta: StoredMeta = {
    v: 2,
    emojiLevel: form.emojiLevel,
    captionLength: form.captionLength,
    ctaPriority: form.ctaPriority,
    avoid: form.avoid,
    avoidNotes: form.avoidNotes,
    profileImported: form.profileImported,
    profileSummary: form.profileSummary,
    selectedAccountId: form.selectedAccountId || undefined,
    customNiche: form.customNiche.trim() || undefined,
    ...extra,
  };
  return `${META_PREFIX}${JSON.stringify(meta)}`;
}

function decodeMeta(raw: string | null | undefined): Partial<StoredMeta> | null {
  if (!raw?.startsWith(META_PREFIX)) return null;
  try {
    return JSON.parse(raw.slice(META_PREFIX.length)) as StoredMeta;
  } catch {
    return null;
  }
}

function splitExamples(text: string | null | undefined): ContentAssistantForm["examples"] {
  const parts = (text ?? "")
    .split(/\n---\n|\n\n---\n\n/)
    .map((p) => p.trim())
    .filter(Boolean);
  const examples = ["", "", "", "", ""] as ContentAssistantForm["examples"];
  for (let i = 0; i < 5; i++) examples[i] = parts[i] ?? "";
  return examples;
}

function joinExamples(examples: ContentAssistantForm["examples"]) {
  return examples.map((e) => e.trim()).filter(Boolean).join("\n\n---\n\n");
}

function parseList(value: string | null | undefined, options: readonly string[]) {
  if (!value) return [];
  return options.filter((item) => value.toLowerCase().includes(item.toLowerCase()));
}

export function playbookToContentForm(playbook: Partial<AiPlaybook> | null): ContentAssistantForm {
  if (!playbook) return { ...DEFAULT_CONTENT_FORM, examples: [...DEFAULT_CONTENT_FORM.examples] };

  const meta = decodeMeta(playbook.extra_knowledge);
  const savedNiche = playbook.niche?.trim() ?? "";
  const exactNiche = NICHE_OPTIONS.find((n) => n.toLowerCase() === savedNiche.toLowerCase());
  const customNiche = meta?.customNiche?.trim() || (exactNiche ? "" : savedNiche);

  return {
    pageName: playbook.brand_name?.trim() || "",
    niche: exactNiche ?? (customNiche ? "Outro" : DEFAULT_CONTENT_FORM.niche),
    customNiche,
    primaryGoal:
      (GOAL_OPTIONS.find((g) => (playbook.cta_style ?? playbook.target_audience ?? "").includes(g)) as GoalOption) ||
      "Ganhar seguidores",
    tones: parseList(playbook.tone_voice, TONE_OPTIONS).length
      ? (parseList(playbook.tone_voice, TONE_OPTIONS) as ToneOption[])
      : [...DEFAULT_CONTENT_FORM.tones],
    emojiLevel: meta?.emojiLevel ?? DEFAULT_CONTENT_FORM.emojiLevel,
    captionLength: meta?.captionLength ?? DEFAULT_CONTENT_FORM.captionLength,
    examples: splitExamples(playbook.example_captions),
    avoid: meta?.avoid?.length ? meta.avoid : [...DEFAULT_CONTENT_FORM.avoid],
    avoidNotes: meta?.avoidNotes ?? playbook.avoid_rules?.trim() ?? "",
    ctaPriority:
      (CTA_PRIORITY_OPTIONS.find((c) => (playbook.cta_style ?? "").includes(c)) as CtaPriorityOption) ||
      DEFAULT_CONTENT_FORM.ctaPriority,
    profileImported: meta?.profileImported ?? false,
    profileSummary: meta?.profileSummary ?? playbook.viral_hooks?.trim() ?? "",
    selectedAccountId: meta?.selectedAccountId ?? "",
  };
}

export function contentFormToPlaybook(form: ContentAssistantForm) {
  const niche = resolveFormNiche(form);
  const toneVoice = [
    `Tom: ${form.tones.join(", ")}.`,
    `Emojis: ${form.emojiLevel}.`,
    `Tamanho da legenda: ${form.captionLength}.`,
    "Português do Brasil, linguagem natural.",
  ].join(" ");

  const ctaStyle = [
    `Objetivo: ${form.primaryGoal}.`,
    `Priorizar CTA de: ${form.ctaPriority}.`,
  ].join(" ");

  const avoidRules = [
    ...form.avoid.map((item) => `Evitar: ${item}.`),
    form.avoidNotes.trim(),
  ]
    .filter(Boolean)
    .join(" ");

  return {
    brand_name: form.pageName.trim(),
    niche,
    target_audience: `Página de ${niche}. Objetivo: ${form.primaryGoal}.`,
    tone_voice: toneVoice,
    viral_hooks: form.profileSummary.trim() || null,
    hashtag_strategy: `Hashtags automáticas para nicho ${niche}: mix de alcance, nicho e marca.`,
    cta_style: ctaStyle,
    example_captions: joinExamples(form.examples),
    avoid_rules: avoidRules || "Evitar linguagem robótica e repetição.",
    extra_knowledge: encodeMeta(form),
  };
}

export function applyProfileImport(
  form: ContentAssistantForm,
  snapshot: {
    username: string;
    name: string;
    biography: string;
    captions: string[];
    hashtags: string[];
    themes: string[];
  },
): ContentAssistantForm {
  const nicheFromThemes = snapshot.themes[0]?.trim();
  const nicheMatch = NICHE_OPTIONS.find((n) => nicheFromThemes?.toLowerCase() === n.toLowerCase());

  const examples = [...form.examples] as ContentAssistantForm["examples"];
  snapshot.captions.slice(0, 5).forEach((caption, i) => {
    examples[i] = caption;
  });

  const summary = [
    snapshot.name ? `Perfil: ${snapshot.name}` : "",
    snapshot.username ? `@${snapshot.username}` : "",
    snapshot.biography ? `Bio: ${snapshot.biography}` : "",
    snapshot.themes.length ? `Temas: ${snapshot.themes.join(", ")}` : "",
    snapshot.hashtags.length ? `Hashtags frequentes: ${snapshot.hashtags.slice(0, 8).join(" ")}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  return {
    ...form,
    pageName: snapshot.username ? `@${snapshot.username}` : snapshot.name || form.pageName,
    niche: nicheMatch ?? (nicheFromThemes ? "Outro" : form.niche),
    customNiche: nicheMatch ? "" : nicheFromThemes || form.customNiche,
    examples,
    profileImported: true,
    profileSummary: summary,
  };
}

export function buildPreviewCaption(form: ContentAssistantForm, seed = 0) {
  const niche = resolveFormNiche(form);
  const hooks = [
    "POV: você finalmente encontrou um conteúdo que cabe na sua rotina 💪",
    "Isso aqui muda o jogo se você quer evoluir de verdade.",
    "Salva esse vídeo — você vai precisar depois.",
  ];
  const bodies = [
    "O problema não é falta de tempo.\n\nÉ falta de estratégia.",
    "Conteúdo direto, sem enrolação, feito pra quem quer resultado.",
    `Página focada em ${niche.toLowerCase()} com linguagem ${form.tones.join(", ").toLowerCase()}.`,
  ];
  const ctas: Record<CtaPriorityOption, string> = {
    Comentários: "Comenta aqui o que você achou — quero saber sua opinião.",
    Compartilhamentos: "Manda pra quem precisa ver isso hoje.",
    Salvamentos: "Salva esse vídeo para fazer depois e envia para quem precisa começar hoje.",
    Seguidores: "Segue o perfil para mais conteúdos como esse.",
    "Cliques no link": "Link na bio com o passo a passo completo.",
  };

  const emoji = form.emojiLevel === "Poucos" ? "" : form.emojiLevel === "Muitos" ? " 🔥💪✨" : " 💪";
  const hook = hooks[seed % hooks.length] + emoji;
  const body = bodies[seed % bodies.length];
  const tags = `#${niche.toLowerCase().replace(/\s+/g, "")} #reels #fyp`;

  if (form.captionLength === "Curta") {
    return `${hook}\n\n${ctas[form.ctaPriority]}\n\n${tags}`;
  }
  if (form.captionLength === "Longa") {
    return `${hook}\n\n${body}\n\nMais um conteúdo pensado para ${form.primaryGoal.toLowerCase()}.\n\n${ctas[form.ctaPriority]}\n\n${tags}`;
  }
  return `${hook}\n\n${body}\n\n${ctas[form.ctaPriority]}\n\n${tags}`;
}

export function buildPreviewCaptions(form: ContentAssistantForm, count = 10) {
  return Array.from({ length: count }, (_, index) => buildPreviewCaption(form, index));
}

export interface ConnectedAccountOption {
  id: string;
  platform: "instagram" | "tiktok";
  username: string | null;
  display_name?: string | null;
  profile_picture_url: string | null;
  /** @deprecated use username */
  ig_username?: string | null;
}

export function accountUsername(account: ConnectedAccountOption) {
  return account.username ?? account.ig_username ?? null;
}

export function accountPageLabel(account: ConnectedAccountOption) {
  const username = accountUsername(account);
  if (username) return `@${username}`;
  if (account.display_name?.trim()) return account.display_name.trim();
  return account.platform === "tiktok" ? "Conta TikTok" : "Conta sem nome";
}

export function resolveSelectedAccountId(
  form: Pick<ContentAssistantForm, "selectedAccountId" | "pageName">,
  accounts: ConnectedAccountOption[],
) {
  if (form.selectedAccountId && accounts.some((account) => account.id === form.selectedAccountId)) {
    return form.selectedAccountId;
  }

  const normalized = form.pageName.trim().replace(/^@/, "").toLowerCase();
  if (normalized) {
    const match = accounts.find(
      (account) => accountUsername(account)?.toLowerCase() === normalized,
    );
    if (match) return match.id;
  }

  return accounts[0]?.id ?? "";
}

export function syncFormWithAccount(
  form: ContentAssistantForm,
  account: ConnectedAccountOption,
  options?: { preservePageName?: boolean },
): ContentAssistantForm {
  return {
    ...form,
    selectedAccountId: account.id,
    pageName:
      options?.preservePageName && form.pageName.trim()
        ? form.pageName
        : accountPageLabel(account),
  };
}

export const FITNESS_TEMPLATE: ContentAssistantForm = {
  ...DEFAULT_CONTENT_FORM,
  ...NICHE_TEMPLATES.Fitness,
  examples: [
    ...(NICHE_TEMPLATES.Fitness.examples ?? DEFAULT_CONTENT_FORM.examples),
    "",
    "",
    "",
    "",
  ].slice(0, 5) as ContentAssistantForm["examples"],
};

// Back-compat aliases for API routes
export type TrainAiFormState = ContentAssistantForm;
export const DEFAULT_TRAIN_AI_FORM = DEFAULT_CONTENT_FORM;
export const playbookToForm = playbookToContentForm;
export const formToPlaybook = contentFormToPlaybook;
