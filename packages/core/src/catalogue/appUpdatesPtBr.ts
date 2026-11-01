import type { appUpdatesEn } from "./appUpdatesEn.ts";

export const appUpdatesPtBr: typeof appUpdatesEn = {
  installTitle: "Instalar Atualizações",
  installMessage:
    "Permita que o Wave instale as próprias atualizações, para as novas versões chegarem sem nenhum passo.",
  installAllow: "Permitir",
  installNotNow: "Agora Não",
  version: (version) => `Versão ${version}`,
};
