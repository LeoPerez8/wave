import type { desktopOutputEn } from "./desktopOutputEn.ts";

export const desktopOutputPtBr: typeof desktopOutputEn = {
  output: "Saída",
  systemDefault: "Padrão do sistema",
  notConnected: (name) => `${name} (desconectado)`,
  hint: "Os alto-falantes ou fones de ouvido em que o Wave toca. Padrão do sistema acompanha a saída que o sistema usa.",
  away: (name) =>
    `${name} não está conectado, então o Wave toca na saída padrão do sistema. Ele volta para ${name} quando for conectado de novo.`,
};
