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
};
