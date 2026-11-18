import type { CatalogueVariants } from "../localisation.ts";

/** `desktopEn.ts` in Brazilian Portuguese, key for key. */
export const desktopPtBr = {
  playbackText: {
    thisPhone: "Este computador",
  },
  settings: {
    howMuchOfAStreamedSongWave:
      "Quanto de uma música online o Wave carrega com antecedência, incluindo as próximas músicas em A Seguir, para continuar tocando sem sinal. Períodos maiores usam mais memória: cerca de 50 MB para 30 minutos. Músicas baixadas tocam do computador.",
  },
  itemActions: {
    labels: {
      share: "Copiar Link",
    },
  },
  songDeletion: {
    removeMessage: {
      one: "O arquivo dela continua neste computador. Para trazê-la de volta, inclua-o de novo em Ajustes › Biblioteca.",
      several:
        "Os arquivos delas continuam neste computador. Para trazê-las de volta, inclua-os de novo em Ajustes › Biblioteca.",
    },
  },
} satisfies CatalogueVariants;
