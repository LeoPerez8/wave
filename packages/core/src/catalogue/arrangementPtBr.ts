import type { arrangementEn } from "./arrangementEn.ts";

export const arrangementPtBr: typeof arrangementEn = {
  remove: (title: string, from: string) => `Remover ${title} ${from}`,
  removeAction: (from: string) => `Remover ${from}`,
  add: (title: string, to: string) => `Adicionar ${title} ${to}`,
  moveUp: "Mover para cima",
  moveDown: "Mover para baixo",
  done: "OK",
  home: { from: "do Início", to: "ao Início" },
  discover: { from: "de Descobrir", to: "a Descobrir" },
  tabBar: { from: "da barra de abas", to: "à barra de abas" },
  editTabBar: "Editar barra de abas",
  notInTabBar: "Fora da barra de abas",
  tabBarNote:
    "Início fica em primeiro, e Buscar mantém seu próprio botão no fim. Cabem até cinco abas.",
};
