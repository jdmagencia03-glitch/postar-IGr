import { getAppUrl } from "@/lib/app-url";

export const APP_NAME = "JDM Hub";
export const APP_TAGLINE = "Poste Sem Limites. Cresça com IA.";
export const APP_DESCRIPTION = `${APP_NAME} — ${APP_TAGLINE} Agende vídeos no Instagram e TikTok com legendas e horários automáticos.`;

export function getAppDomainLabel() {
  try {
    return new URL(getAppUrl()).host;
  } catch {
    return "jdmhub.vercel.app";
  }
}
