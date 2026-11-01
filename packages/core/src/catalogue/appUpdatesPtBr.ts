import type { appUpdatesEn } from "./appUpdatesEn.ts";

export const appUpdatesPtBr: typeof appUpdatesEn = {
  updateTheApp: "Atualizar o app",
  ignoreThisUpdate: "Ignorar Esta Atualização",
  version: (version) => `Versão ${version}`,
  checkForUpdates: "Verificar atualizações",
  percent: (percent) => `${percent}%`,
  downloading: (percent) => `Baixando a atualização, ${percent}%`,
  upToDate: "O Wave está atualizado",
  bundleOnItsWay:
    "Uma atualização está a caminho. Ela é aplicada quando o Wave ficar em segundo plano.",
  checkFailed: "Não foi possível verificar atualizações",
  downloadFailed: "Não foi possível baixar a atualização",
  installFailed: "Não foi possível instalar a atualização",
  mobileDataTitle: "Baixar a atualização com dados móveis?",
  mobileDataMessage: (size) => `Baixa cerca de ${size}, e o celular não está no Wi-Fi.`,
  download: "Baixar",
  notNow: "Agora não",
};
