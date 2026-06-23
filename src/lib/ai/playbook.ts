import type { SupabaseClient } from "@supabase/supabase-js";
import type { AiPlaybook, AccountPlaybookPayload } from "@/lib/types";
import { createAdminClient } from "@/lib/supabase/admin";
import { CAPTION_LAYOUT_EXAMPLE } from "@/lib/ai/caption-format";

export const EMPTY_PLAYBOOK: Omit<AiPlaybook, "owner_id" | "created_at" | "updated_at"> = {
  brand_name: "",
  niche: "",
  target_audience: "",
  tone_voice: "",
  viral_hooks: "",
  hashtag_strategy: "",
  cta_style: "",
  example_captions: "",
  avoid_rules: "",
  extra_knowledge: "",
  playbooks_by_account: {},
};

const MAX_PLAYBOOK_CHARS = 18_000;
const META_PREFIX = "__meta_v2__:";

function trimSection(value: string | null | undefined, max = 3000) {
  if (!value?.trim()) return "";
  return value.trim().slice(0, max);
}

function extractLegacyAccountId(playbook: AiPlaybook | null | undefined) {
  const raw = playbook?.extra_knowledge;
  if (!raw?.startsWith(META_PREFIX)) return null;
  try {
    const meta = JSON.parse(raw.slice(META_PREFIX.length)) as { selectedAccountId?: string };
    return meta.selectedAccountId ?? null;
  } catch {
    return null;
  }
}

function payloadFromRow(row: Partial<AiPlaybook>): AccountPlaybookPayload {
  return {
    brand_name: row.brand_name ?? null,
    niche: row.niche ?? null,
    target_audience: row.target_audience ?? null,
    tone_voice: row.tone_voice ?? null,
    viral_hooks: row.viral_hooks ?? null,
    hashtag_strategy: row.hashtag_strategy ?? null,
    cta_style: row.cta_style ?? null,
    example_captions: row.example_captions ?? null,
    avoid_rules: row.avoid_rules ?? null,
    extra_knowledge: row.extra_knowledge ?? null,
  };
}

function playbookFromPayload(ownerId: string, payload: AccountPlaybookPayload): AiPlaybook {
  const now = new Date().toISOString();
  return {
    owner_id: ownerId,
    ...payload,
    playbooks_by_account: {},
    created_at: now,
    updated_at: now,
  };
}

async function getPlaybookRow(ownerId: string, supabase = createAdminClient()) {
  const { data } = await supabase
    .from("ai_playbooks")
    .select(
      "brand_name, niche, target_audience, tone_voice, viral_hooks, hashtag_strategy, cta_style, example_captions, avoid_rules, extra_knowledge, playbooks_by_account",
    )
    .eq("owner_id", ownerId)
    .maybeSingle();

  return (data as AiPlaybook | null) ?? null;
}

/** @deprecated Use getPlaybookForAccount */
export async function getPlaybookForOwner(ownerId: string): Promise<AiPlaybook | null> {
  return getPlaybookRow(ownerId);
}

export async function getPlaybookForAccount(
  ownerId: string,
  accountId: string,
): Promise<AiPlaybook | null> {
  const row = await getPlaybookRow(ownerId);
  if (!row) return null;

  const map = row.playbooks_by_account ?? {};
  const perAccount = map[accountId];
  if (perAccount && playbookHasContent(perAccount)) {
    return playbookFromPayload(ownerId, perAccount);
  }

  const mapHasEntries = Object.keys(map).length > 0;
  if (mapHasEntries) return null;

  if (playbookHasContent(row)) {
    const legacyAccountId = extractLegacyAccountId(row);
    if (!legacyAccountId || legacyAccountId === accountId) {
      return { ...row, owner_id: ownerId };
    }
  }

  return null;
}

export async function ownerHasConfiguredPlaybook(
  ownerId: string,
  supabase = createAdminClient(),
) {
  const row = await getPlaybookRow(ownerId, supabase);
  if (!row) return false;

  const map = row.playbooks_by_account ?? {};
  if (Object.values(map).some((entry) => playbookHasContent(entry))) return true;
  return playbookHasContent(row);
}

export async function savePlaybookForAccount(
  ownerId: string,
  accountId: string,
  payload: AccountPlaybookPayload,
) {
  const supabase = createAdminClient();
  const row = await getPlaybookRow(ownerId);
  const map = { ...(row?.playbooks_by_account ?? {}) };
  map[accountId] = payload;

  const upsertPayload = {
    owner_id: ownerId,
    playbooks_by_account: map,
    updated_at: new Date().toISOString(),
    ...(row
      ? {}
      : {
          brand_name: null,
          niche: null,
          target_audience: null,
          tone_voice: null,
          viral_hooks: null,
          hashtag_strategy: null,
          cta_style: null,
          example_captions: null,
          avoid_rules: null,
          extra_knowledge: null,
        }),
  };

  const { data, error } = await supabase
    .from("ai_playbooks")
    .upsert(upsertPayload, { onConflict: "owner_id" })
    .select()
    .single();

  if (error) throw new Error(error.message);
  return getPlaybookForAccount(ownerId, accountId) ?? playbookFromPayload(ownerId, payload);
}

export function resolveNicheFromPlaybook(
  playbook: AiPlaybook | AccountPlaybookPayload | null,
  explicitNiche?: string,
) {
  const fromParam = explicitNiche?.trim();
  if (fromParam) return fromParam;
  const fromPlaybook = playbook?.niche?.trim();
  if (fromPlaybook) return fromPlaybook;
  return "conteúdo digital";
}

export function playbookHasContent(playbook: AiPlaybook | AccountPlaybookPayload | null) {
  if (!playbook) return false;
  return Boolean(
    playbook.brand_name?.trim() ||
      playbook.niche?.trim() ||
      playbook.target_audience?.trim() ||
      playbook.tone_voice?.trim() ||
      playbook.viral_hooks?.trim() ||
      playbook.hashtag_strategy?.trim() ||
      playbook.cta_style?.trim() ||
      playbook.example_captions?.trim() ||
      playbook.avoid_rules?.trim() ||
      (playbook.extra_knowledge?.trim() && !playbook.extra_knowledge.startsWith(META_PREFIX)),
  );
}

export function buildPlaybookContext(playbook: AiPlaybook | AccountPlaybookPayload | null, fallbackNiche: string) {
  const sections: string[] = [];

  if (playbook?.brand_name?.trim()) {
    sections.push(`Marca/perfil: ${trimSection(playbook.brand_name, 200)}`);
  }

  sections.push(`Nicho: ${trimSection(playbook?.niche, 500) || fallbackNiche}`);

  if (playbook?.target_audience?.trim()) {
    sections.push(`Público-alvo:\n${trimSection(playbook.target_audience, 1500)}`);
  }

  if (playbook?.tone_voice?.trim()) {
    sections.push(`Tom de voz:\n${trimSection(playbook.tone_voice, 1000)}`);
  }

  if (playbook?.viral_hooks?.trim()) {
    sections.push(`Contexto da página:\n${trimSection(playbook.viral_hooks, 2500)}`);
  }

  if (playbook?.hashtag_strategy?.trim()) {
    sections.push(`Estratégia de hashtags:\n${trimSection(playbook.hashtag_strategy, 1500)}`);
  }

  if (playbook?.cta_style?.trim()) {
    sections.push(`Estilo de CTA (chamada para ação):\n${trimSection(playbook.cta_style, 1000)}`);
  }

  if (playbook?.example_captions?.trim()) {
    sections.push(`Exemplos de legendas que funcionaram:\n${trimSection(playbook.example_captions, 4000)}`);
  }

  if (playbook?.avoid_rules?.trim()) {
    sections.push(`Nunca faça / evite:\n${trimSection(playbook.avoid_rules, 1000)}`);
  }

  const extra = playbook?.extra_knowledge?.trim();
  if (extra && !extra.startsWith(META_PREFIX)) {
    sections.push(`Observações extras:\n${trimSection(extra, 8000)}`);
  }

  const context = sections.join("\n\n");
  return context.slice(0, MAX_PLAYBOOK_CHARS);
}

export function buildViralSystemPrompt(
  playbook: AiPlaybook | AccountPlaybookPayload | null,
  fallbackNiche: string,
) {
  const playbookContext = buildPlaybookContext(playbook, fallbackNiche);

  return `Você é um estrategista sênior de Instagram Reels no Brasil, especializado em conteúdo viral.

IMPORTANTE — ESCOPO DA IA:
- Você trabalha APENAS com TEXTO: legendas e hashtags.
- Você NÃO edita, corta, altera, melhora ou modifica vídeos de nenhuma forma.
- O vídeo é enviado pelo usuário exatamente como está; sua única função é escrever a legenda.
- Os horários de publicação são definidos pelo sistema, não por você.

Seu objetivo é maximizar retenção, comentários, salvamentos, compartilhamentos e alcance orgânico através das LEGENDAS.

PLAYBOOK DA MARCA (siga rigorosamente):
${playbookContext || `Nicho: ${fallbackNiche}. Use ganchos fortes, linguagem brasileira, CTA claro e hashtags estratégicas.`}

REGRAS DE OURO PARA LEGENDAS VIRAIS:
- Primeira linha = gancho irresistível (curiosidade, polêmica leve, benefício ou identificação)
- Texto escaneável: frases curtas, quebras de linha, 1-3 emojis estratégicos
- CTA que gera comentário ("comenta X", "salva pra ver depois", "manda pra quem precisa")
- 10-15 hashtags: mix de alcance alto + nicho específico + branded
- Cada legenda 100% única (nunca repetir estrutura)
- Português do Brasil, natural, sem parecer robô
- Máximo 2200 caracteres por legenda

FORMATO OBRIGATÓRIO (use \\n literalmente no JSON para quebrar linha):
- Cada bloco de mensagem em UMA linha separada
- Linha em branco (\\n\\n) antes do bloco de hashtags
- Quando houver CTA com emoji (📌, 🔥, 👇), cada um começa uma NOVA linha
- NUNCA junte frases diferentes na mesma linha

Exemplo exato de formatação:
${CAPTION_LAYOUT_EXAMPLE}

Retorne APENAS JSON válido: {"captions":["legenda 1","legenda 2",...]}
Cada string do array deve conter \\n para quebras de linha reais.`;
}

export function buildViralUserPrompt(params: {
  count: number;
  filenames: string[];
  niche: string;
  username?: string;
}) {
  const fileList = params.filenames
    .map((name, index) => {
      const clean = name
        .replace(/\.[^.]+$/, "")
        .replace(/[_-]+/g, " ")
        .trim();
      return `${index + 1}. ${clean || `video-${index + 1}`}`;
    })
    .join("\n");

  return `Crie exatamente ${params.count} legendas virais para Reels.

Conta: @${params.username ?? "perfil"}
Nicho da conta (use EXCLUSIVAMENTE este nicho — não invente outro): ${params.niche}

Lista de vídeos (use o nome do arquivo apenas como pista de tema para a legenda — NÃO edite o vídeo):
${fileList}

Para cada vídeo, escreva APENAS a legenda com hashtags:
1. Use o nome do arquivo como referência de tema
2. Aplique o playbook da marca
3. Otimize a legenda para viralização no algoritmo do Instagram
4. Varie o estilo entre as legendas (storytelling, lista, pergunta, desafio, etc.)
5. Siga o FORMATO OBRIGATÓRIO: uma ideia por linha, linha em branco antes das hashtags`;
}

export { payloadFromRow };
