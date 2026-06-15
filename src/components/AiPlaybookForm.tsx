"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Brain, Save, Sparkles } from "lucide-react";
import type { AiPlaybook } from "@/lib/types";

const DEFAULT_TEMPLATE: Omit<AiPlaybook, "owner_id" | "created_at" | "updated_at"> = {
  brand_name: "De Olho no Shape",
  niche: "fitness, emagrecimento, treino em casa e lifestyle saudável",
  target_audience:
    "Homens e mulheres 18-45 anos que querem emagrecer, definir o corpo e manter disciplina. Buscam dicas rápidas, motivação e treinos práticos.",
  tone_voice:
    "Direto, motivacional, próximo e sem enrolação. Linguagem brasileira informal. Energia positiva com urgência leve.",
  viral_hooks: `POV: você descobriu o exercício que ninguém te contou...
Isso aqui destruiu minha barriga em 30 dias (sem mentira)
O erro que 90% das pessoas cometem no treino
Se você tem só 10 minutos, faz isso
Salva esse Reel se você quer resultado de verdade`,
  hashtag_strategy: `Mix obrigatório:
- 3-4 hashtags grandes: #fitness #reels #fyp #viral
- 4-5 hashtags de nicho: #treinoemcasa #emagrecimento #hipertrofia #deolhonoshape
- 2-3 hashtags de comunidade: #fitnessbrasil #reelsbrasil #vidasaudavel
- 1 hashtag da marca: #deolhonoshape`,
  cta_style:
    'Comenta "QUERO" se você vai treinar hoje. Salva pra não perder. Manda pra quem precisa ver isso.',
  example_captions: "",
  avoid_rules:
    "Não editar, cortar ou alterar vídeos — a IA só escreve legendas e hashtags. Não usar linguagem robótica. Não repetir a mesma estrutura em todas as legendas. Não exagerar em emojis. Não prometer resultados milagrosos irreais.",
  extra_knowledge: "",
};

type FormState = Omit<AiPlaybook, "owner_id" | "created_at" | "updated_at">;

function countChars(form: FormState) {
  return Object.values(form).join("").length;
}

export function AiPlaybookForm() {
  const [form, setForm] = useState<FormState>(DEFAULT_TEMPLATE);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [hasOpenAi, setHasOpenAi] = useState(false);

  const totalChars = useMemo(() => countChars(form), [form]);

  const fetchPlaybook = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/ai/playbook", { credentials: "include", cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Falha ao carregar");

      setHasOpenAi(Boolean(data.has_openai_key));
      setForm({
        brand_name: data.brand_name ?? "",
        niche: data.niche ?? "",
        target_audience: data.target_audience ?? "",
        tone_voice: data.tone_voice ?? "",
        viral_hooks: data.viral_hooks ?? "",
        hashtag_strategy: data.hashtag_strategy ?? "",
        cta_style: data.cta_style ?? "",
        example_captions: data.example_captions ?? "",
        avoid_rules: data.avoid_rules ?? "",
        extra_knowledge: data.extra_knowledge ?? "",
      });
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Erro ao carregar playbook");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPlaybook();
  }, [fetchPlaybook]);

  function updateField<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function loadTemplate() {
    setForm(DEFAULT_TEMPLATE);
    setMessage("Modelo carregado. Edite e salve para treinar a IA.");
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
        body: JSON.stringify(form),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Falha ao salvar");

      setHasOpenAi(Boolean(data.has_openai_key));
      setMessage("Playbook salvo! A IA usará esse conteúdo em todos os agendamentos.");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Erro ao salvar");
    } finally {
      setSaving(false);
    }
  }

  const fields: Array<{
    key: keyof FormState;
    label: string;
    hint: string;
    rows?: number;
    placeholder: string;
  }> = [
    {
      key: "brand_name",
      label: "Nome da marca / perfil",
      hint: "Como a IA deve se referir ao seu perfil.",
      placeholder: "De Olho no Shape",
    },
    {
      key: "niche",
      label: "Nicho",
      hint: "Tema principal do conteúdo.",
      placeholder: "fitness, emagrecimento, treino...",
    },
    {
      key: "target_audience",
      label: "Público-alvo",
      hint: "Quem você quer atingir? Idade, dores, desejos.",
      rows: 3,
      placeholder: "Descreva seu público ideal...",
    },
    {
      key: "tone_voice",
      label: "Tom de voz",
      hint: "Como a legenda deve soar.",
      rows: 3,
      placeholder: "Motivacional, direto, engraçado...",
    },
    {
      key: "viral_hooks",
      label: "Ganchos que viralizam",
      hint: "Cole frases de abertura que funcionam no seu nicho.",
      rows: 6,
      placeholder: "Um gancho por linha...",
    },
    {
      key: "hashtag_strategy",
      label: "Estratégia de hashtags",
      hint: "Quais hashtags usar, quantas, mix de alcance/nicho.",
      rows: 5,
      placeholder: "#fitness #reels #fyp + hashtags do nicho...",
    },
    {
      key: "cta_style",
      label: "Estilo de CTA",
      hint: "Como pedir comentário, save ou compartilhamento.",
      rows: 3,
      placeholder: 'Ex.: Comenta "QUERO" se...',
    },
    {
      key: "example_captions",
      label: "Legendas que já funcionaram (máximo de exemplos)",
      hint: "Cole posts virais seus ou de referência. Quanto mais, melhor.",
      rows: 10,
      placeholder: "Cole aqui legendas completas que deram bom resultado...",
    },
    {
      key: "avoid_rules",
      label: "O que evitar",
      hint: "O que a IA NÃO deve fazer.",
      rows: 3,
      placeholder: "Não prometer milagres, não repetir estrutura...",
    },
    {
      key: "extra_knowledge",
      label: "Base de conhecimento extra (cole tudo aqui)",
      hint: "Roteiros, frases, referências, concorrentes, pilares de conteúdo, palavras-chave, etc.",
      rows: 12,
      placeholder: "Cole o máximo de conteúdo estratégico que tiver...",
    },
  ];

  if (loading) {
    return (
      <div className="rounded-xl border border-white/10 bg-white/5 p-8 text-center text-zinc-400">
        Carregando playbook da IA...
      </div>
    );
  }

  return (
    <form onSubmit={handleSave} className="space-y-6">
      <div className="rounded-xl border border-pink-500/20 bg-pink-500/10 p-4">
        <div className="flex items-start gap-3">
          <Brain className="mt-0.5 shrink-0 text-pink-300" size={20} />
          <div className="text-sm text-pink-100">
            <p className="font-medium">Como funciona</p>
            <p className="mt-1 text-pink-100/80">
              Tudo que você salvar aqui vai para o <strong>GPT-4o mini</strong> criar{" "}
              <strong>legendas e hashtags</strong>. A IA <strong>não edita vídeos</strong> — o vídeo
              sobe do jeito que você enviou. Os horários são calculados automaticamente pelo sistema.
            </p>
            <p className="mt-2 text-xs text-pink-200/70">
              {hasOpenAi
                ? "✓ OPENAI_API_KEY configurada — GPT ativo"
                : "⚠ Configure OPENAI_API_KEY na Vercel para usar GPT (sem ela, usa legendas automáticas)"}
            </p>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={loadTemplate}
          className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-zinc-200 hover:bg-white/10"
        >
          <Sparkles size={14} />
          Carregar modelo fitness
        </button>
        <span className="self-center text-xs text-zinc-500">
          {totalChars.toLocaleString("pt-BR")} caracteres de conhecimento
        </span>
      </div>

      {fields.map((field) => (
        <div key={field.key}>
          <label className="mb-1 block text-sm font-medium text-zinc-200">{field.label}</label>
          <p className="mb-2 text-xs text-zinc-500">{field.hint}</p>
          {field.rows ? (
            <textarea
              value={form[field.key] ?? ""}
              onChange={(e) => updateField(field.key, e.target.value)}
              rows={field.rows}
              placeholder={field.placeholder}
              className="w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm text-white"
            />
          ) : (
            <input
              type="text"
              value={form[field.key] ?? ""}
              onChange={(e) => updateField(field.key, e.target.value)}
              placeholder={field.placeholder}
              className="w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-white"
            />
          )}
        </div>
      ))}

      <button
        type="submit"
        disabled={saving}
        className="flex w-full items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-pink-500 to-purple-600 px-4 py-3 font-medium text-white hover:opacity-90 disabled:opacity-50"
      >
        <Save size={16} />
        {saving ? "Salvando..." : "Salvar e treinar IA"}
      </button>

      {message && (
        <p
          className={`text-sm ${
            message.includes("salvo") || message.includes("carregado")
              ? "text-emerald-300"
              : "text-red-300"
          }`}
        >
          {message}
        </p>
      )}
    </form>
  );
}
