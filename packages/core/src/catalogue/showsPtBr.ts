import { plural } from "../plural.ts";
import { formatNumber } from "../formatting.ts";
import type { showsEn } from "./showsEn.ts";
export const showsPtBr: typeof showsEn = {
  country: "País",
  phoneRegion: "Região do celular",
  releases: "Novas músicas",
  level: "Novas músicas e shows",
  shelf: (country: string) => `Shows em ${country}`,
  notificationsOff: "As notificações estão desativadas",
  notificationSettings: "Abrir configurações de notificações",
  channel: "Shows",
  tickets: "Ingressos",
  newReleases: "Novos lançamentos",
  newReleasesAndShowsIn: (country) => `Novos lançamentos e shows em ${country}`,
  iconFor: (option, artist) => `${option}, ${artist}`,
  unfollowed: (artist) => `Você deixou de seguir ${artist}`,
  undo: "Desfazer",
  suggested: "Sugestões",
  showMore: "Mostrar Mais",
  dismissSuggestion: (artist) => `Dispensar a sugestão ${artist}`,
  suggestionDismissed: "Sugestão dispensada",
  playsInLast90Days: (count) =>
    plural("pt-BR", count, {
      one: `${formatNumber("pt-BR", count)} reprodução nos últimos 90 dias`,
      other: `${formatNumber("pt-BR", count)} reproduções nos últimos 90 dias`,
    }),
  allTimePlays: (count) =>
    plural("pt-BR", count, {
      one: `${formatNumber("pt-BR", count)} reprodução`,
      other: `${formatNumber("pt-BR", count)} reproduções`,
    }),
};
