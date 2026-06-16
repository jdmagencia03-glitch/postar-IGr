import type { AiPlaybook } from "@/lib/types";
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
};

const MAX_PLAYBOOK_CHARS = 18_000;

function trimSection(value: string | null | undefined, max = 3000) {
  if (!value?.trim()) return "";
  return value.trim().slice(0, max);
}

export async function getPlaybookForOwner(ownerId: string): Promise<AiPlaybook | null> {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("ai_playbooks")
    .select("*")
    .eq("owner_id", ownerId)
    .maybeSingle();

  return (data as AiPlaybook | null) ?? null;
}

export function playbookHasContent(playbook: AiPlaybook | null) {
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
      playbook.extra_knowledge?.trim(),
  );
}

export function buildPlaybookContext(playbook: AiPlaybook | null, fallbackNiche: string) {
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
  if (extra && !extra.startsWith("__meta_v2__:")) {
    sections.push(`Observações extras:\n${trimSection(extra, 8000)}`);
  }

  const context = sections.join("\n\n");
  return context.slice(0, MAX_PLAYBOOK_CHARS);
}

export function buildViralSystemPrompt(playbook: AiPlaybook | null, fallbackNiche: string) {
  const playbookContext = buildPlaybookContext(playbook, fallbackNiche);

  return `Você é um estrategista sênior de Instagram Reels no Brasil, especializado em conteúdo viral.

IMPORTANTE — ESCOPO DA IA:
- Você trabalha APENAS com TEXTO: legendas e hashtags.
- Você NÃO edita, corta, altera, melhora ou modifica vídeos de nenhuma forma.
- O vídeo é enviado pelo usuário exatamente como está; sua única função é escrever a legenda.
- Os horários de publicação são definidos pelo sistema, não por você.

Seu objetivo é maximizar retenção, comentários, salvamentos, compartilhamentos e alcance orgânico através das LEGENDAS.

PLAYBOOK DA MARCA (siga rigorosamente):
${playbookContext || `Nicho padrão: ${fallbackNiche}. Use ganchos fortes, linguagem brasileira, CTA claro e hashtags estratégicas.`}

REGRAS DE OURO PARA LEGENDAS VIRAIS:
- Primeira linha = gancho irresistível (curiosidade, polêmica leve, benefício ou identificação)
- Texto escaneável: frases curtas, quebras de linha, 1-3 emojis estratégicos
- CTA que gera comentário ("comenta X", "salva pra treinar depois", "manda pra quem precisa")
- 10-15 hashtags: mix de alcance alto + nicho específico + branded
- Cada legenda 100% única (nunca repetir estrutura)
- Português do Brasil, natural, sem parecer robô
- Máximo 2200 caracteres por legenda

FORMATO OBRIGATÓRIO (use \\n literalmente no JSON para quebrar linha):
- Cada bloco de mensagem em UMA linha separada
- Linha em branco (\\n\\n) antes do bloco de hashtags
- Quando houver CTA com emoji (📌, 🔥, 💪, 👇), cada um começa uma NOVA linha
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
Nicho da sessão: ${params.niche}

Lista de vídeos (use o nome do arquivo apenas como pista de tema para a legenda — NÃO edite o vídeo):
${fileList}

Para cada vídeo, escreva APENAS a legenda com hashtags:
1. Use o nome do arquivo como referência de tema
2. Aplique o playbook da marca
3. Otimize a legenda para viralização no algoritmo do Instagram
4. Varie o estilo entre as legendas (storytelling, lista, pergunta, desafio, etc.)
5. Siga o FORMATO OBRIGATÓRIO: uma ideia por linha, linha em branco antes das hashtags`;
}
