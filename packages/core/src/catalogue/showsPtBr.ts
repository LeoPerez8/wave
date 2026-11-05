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
};
