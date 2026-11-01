import type { whatsNewEn } from "./whatsNewEn.ts";

export const whatsNewPtBr: typeof whatsNewEn = {
  title: "Novidades",
  new: "Novo",
  fixes: "Correções",
  done: "OK",
  installTitle: "Instalar atualizações",
  installMessage:
    "Permita que o Wave instale as próprias atualizações, para as novas versões chegarem sem nenhum passo.",
  installAllow: "Permitir",
  installNotNow: "Agora não",
  version: (version) => `Versão ${version}`,
};
