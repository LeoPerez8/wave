import type { collaborativePageEn } from "./collaborativePageEn.ts";

export const collaborativePagePtBr: typeof collaborativePageEn = {
  libraryDetail: (count: string) => `Colaborativa · ${count}`,
  changed: "Alterada em outro aparelho",
  memberNames: (names: readonly string[]): string => {
    const shown = names.slice(0, 3);
    const more = names.length - shown.length;
    if (more > 0) return `${shown.join(", ")} e mais ${more}`;
    if (shown.length <= 1) return shown[0] ?? "";
    return `${shown.slice(0, -1).join(", ")} e ${shown[shown.length - 1]}`;
  },
  membersLabel: (names: string) => `Membros: ${names}`,
  addedBy: (name: string) => `Adicionada por ${name}`,
  privateCopyTitle: "Esta playlist não é mais colaborativa",
  privateCopyBody: "Agora ela é uma cópia só sua. O que você mudar aqui não chega aos outros.",
  ok: "OK",
};
