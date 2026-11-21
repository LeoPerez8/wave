import type { djEn } from "./djEn.ts";

export const djPtBr: typeof djEn = {
  title: "DJ",
  cardDetail: "Escolha os artistas que iniciam sua fila",
  done: "Concluído",
  close: "Fechar",
  starting: "Iniciando sua fila",
  artistTile: (name: string) => `Artista, ${name}`,
  loadingArtists: "Carregando artistas",
  nothingToPick: "Nada para escolher ainda. Ouça algumas músicas e volte depois.",
  noSongsFound: "Nenhuma música encontrada para esses artistas.",
  magicQueueFromDj: "Fila Mágica · de DJ",
};
