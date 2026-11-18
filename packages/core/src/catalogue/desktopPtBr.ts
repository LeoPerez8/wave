import type { CatalogueVariants } from "../localisation.ts";

/** `desktopEn.ts` in Brazilian Portuguese, key for key. */
export const desktopPtBr = {
  playbackText: {
    thisPhone: "Este computador",
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
