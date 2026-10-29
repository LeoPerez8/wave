import { formatNumber } from "../formatting.ts";
import type { songDeletionEn } from "./songDeletionEn.ts";

const n = (count: number): string => formatNumber("pt-BR", count);

export const songDeletionPtBr: typeof songDeletionEn = {
  deleteSongs: (count) => `Apagar ${n(count)} músicas?`,
  deleteSong: (title) => `Apagar “${title}”?`,
  deleteMessage: {
    one: "O arquivo é removido do seu celular.",
    several: "Os arquivos são removidos do seu celular.",
    oneSignedIn: "O arquivo é removido do seu celular, e a música, da sua Conta Wave.",
    severalSignedIn: "Os arquivos são removidos do seu celular, e as músicas, da sua Conta Wave.",
  },
  delete: "Apagar",
  removeSongs: (count) => `Remover ${n(count)} músicas da sua Biblioteca?`,
  removeSong: (title) => `Remover “${title}” da sua Biblioteca?`,
  removeMessage: {
    one: "Ela também sai da sua Conta Wave. Seus outros celulares a perdem na próxima sincronização, a menos que tenham o arquivo dela.",
    several:
      "Elas também saem da sua Conta Wave. Seus outros celulares as perdem na próxima sincronização, a menos que tenham os arquivos delas.",
  },
  remove: "Remover",
  reasons: {
    missing: "O arquivo já não existe.",
    denied: "O Wave não tem permissão para apagá-lo.",
    readOnly: "O armazenamento dele é somente leitura.",
    failed: "Não foi possível apagar o arquivo.",
  },
  couldntDeleteSong: (title) => `Não foi possível apagar “${title}”`,
  songStays: "A música continua na sua biblioteca.",
  couldntDeleteSongs: (failed, attempted) =>
    `Não foi possível apagar ${n(failed)} de ${n(attempted)} músicas`,
  oneStays: "Ela continua na sua biblioteca.",
  severalStay: "Elas continuam na sua biblioteca.",
  more: (count) => `E mais ${n(count)}.`,
  couldntRemoveSongs: "Não foi possível remover as músicas",
  couldntUpdateLibrary: "Não foi possível atualizar a biblioteca",
};
