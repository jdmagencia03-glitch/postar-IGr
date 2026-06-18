export const STORY_OBJECTIVES = [
  "Puxar para link da bio",
  "Mandar para DM",
  "Mandar para WhatsApp",
  "Divulgar oferta",
  "Avisar promoção",
  "Gerar curiosidade",
  "Reforçar prova social",
  "Aquecer audiência",
  "Remarketing",
  "Puxar para checkout",
  "Puxar para página de vendas",
] as const;

export type StoryObjective = (typeof STORY_OBJECTIVES)[number];

export const STORY_CTA_OPTIONS = [
  "Link na bio",
  "Me chama no direct",
  "Responde EU QUERO",
  "Oferta disponível hoje",
  "Clique no link do perfil",
  "Últimas unidades",
  "Receba agora",
  "Chama no WhatsApp",
  "Veja antes que saia do ar",
  "Quer receber? Me chama agora",
  "Cupom disponível hoje",
] as const;

export type StoryCtaOption = (typeof STORY_CTA_OPTIONS)[number];

export interface StoryScheduleItem {
  media_url: string;
  filename: string;
  story_text?: string;
  story_cta: string;
  story_link?: string | null;
  story_objective: string;
}

export interface StoryPreviewEntry {
  index: number;
  filename: string;
  media_url: string;
  scheduled_at: string;
  story_text: string;
  story_cta: string;
  story_link: string | null;
  story_objective: string;
}
