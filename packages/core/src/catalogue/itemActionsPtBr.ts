import { formatNumber } from "../formatting.ts";
import type { itemActionsEn } from "./itemActionsEn.ts";
import { playbackTextPtBr } from "./playbackTextPtBr.ts";

export const itemActionsPtBr: typeof itemActionsEn = {
  labels: {
    playNext: "Reproduzir a Seguir",
    addToQueue: "Adicionar à Fila",
    magicQueue: "Fila Mágica",
    addToPlaylist: "Adicionar à Playlist",
    favorite: "Favoritar",
    unfavorite: "Remover das Favoritas",
    removeFromPlaylist: "Remover da Playlist",
    goToAlbum: "Ir para o Álbum",
    goToArtist: "Ir para o Artista",
    renamePlaylist: "Renomear Playlist",
    changeImage: "Alterar Imagem",
    adjustImage: "Ajustar Imagem",
    removeImage: "Remover Imagem",
    share: "Compartilhar",
    releaseDate: "Data de Lançamento",
    deletePlaylist: "Apagar Playlist",
    deletePlaylists: "Apagar Playlists",
    fixSong: "Corrigir Música",
    fixSongs: "Corrigir Músicas",
    select: "Selecionar",
    delete: "Apagar",
    removeFromLibrary: "Remover da Biblioteca",
    download: "Baixar",
    cancelDownload: "Cancelar Download",
    retryDownload: "Tentar Baixar Novamente",
    downloadMissingSongs: "Baixar Músicas Ausentes",
    retryFailed: "Tentar Falhas Novamente",
    sleepTimer: "Timer para Dormir",
    related: playbackTextPtBr.related,
  },
  barLabels: {
    unfavorite: "Des­favoritar",
    removeFromPlaylist: "Remover",
    downloadMissingSongs: "Baixar",
  },
  playLabels: {
    play: "Reproduzir",
    playNext: "Reproduzir a Seguir",
    addToQueue: "Adicionar à Fila",
    shuffle: "Aleatório",
  },
  remove: "Remover",
  releaseDateIs: (date) => `Data de Lançamento · ${date}`,
  sleepTimerIs: (left) => `Timer para Dormir · ${left}`,
  addedToFavorites: "Adicionada às Favoritas",
  addedSongsToFavorites: (count) =>
    `${formatNumber("pt-BR", count)} músicas adicionadas às Favoritas`,
};
