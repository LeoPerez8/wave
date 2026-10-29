import { formatNumber } from "../formatting.ts";
import { plural } from "../plural.ts";
import type { playlistsEn } from "./playlistsEn.ts";

const n = (count: number): string => formatNumber("pt-BR", count);

const songs = (count: number): string =>
  plural("pt-BR", count, {
    zero: "Nenhuma música",
    one: `${n(count)} música`,
    other: `${n(count)} músicas`,
  });

/** "1 música" without the zero form, where a count follows another word. */
const counted = (count: number): string =>
  plural("pt-BR", count, { one: `${n(count)} música`, other: `${n(count)} músicas` });

export const playlistsPtBr: typeof playlistsEn = {
  defaultName: "Nova Playlist",
  newPlaylist: "Nova Playlist",
  newPlaylistTitle: "Nova playlist",
  create: "Criar",
  renamePlaylist: "Renomear playlist",
  rename: "Renomear",
  playlistName: "Nome da playlist",
  cancel: "Cancelar",
  nameEmpty: "Dê um nome à playlist.",
  nameTaken: "Outra playlist já tem esse nome.",
  nameTooLong: "O nome pode ter até 100 caracteres.",
  addToPlaylist: "Adicionar à playlist",
  created: (name: string): string => `${name} criada`,
  couldntList: "Não foi possível listar as playlists",
  couldntAdd: "Não foi possível adicionar à playlist",
  couldntCreate: "Não foi possível criar a playlist",
  couldntRename: "Não foi possível renomear a playlist",
  couldntChangeImage: "Não foi possível alterar a imagem",
  couldntAdjustImage: "Não foi possível ajustar a imagem",
  couldntRemoveImage: "Não foi possível remover a imagem",
  couldntDelete: (count: number): string =>
    count === 1 ? "Não foi possível apagar a playlist" : "Não foi possível apagar as playlists",
  playlistActions: "Ações da playlist",
  noSongsYet: "Nenhuma música ainda",
  addSongsHint: "Toque e segure uma música, um álbum ou um artista e escolha Adicionar à Playlist.",
  deleted: "Ela foi apagada.",
  noPlaylists: "Nenhuma playlist",
  playlistCount: (count: number): string =>
    plural("pt-BR", count, {
      zero: "Nenhuma playlist",
      one: `${n(count)} playlist`,
      other: `${n(count)} playlists`,
    }),
  importPlaylists: "Importar Playlists",
  moveUp: "Mover para cima",
  moveDown: "Mover para baixo",
  removed: (count: number): string =>
    plural("pt-BR", count, {
      one: "Música removida da playlist",
      other: `${n(count)} músicas removidas da playlist`,
    }),
  undo: "Desfazer",
  couldntRestore: "Não foi possível restaurar as músicas",
  songs,
  unavailable: (count: number): string =>
    plural("pt-BR", count, {
      one: `${n(count)} indisponível`,
      other: `${n(count)} indisponíveis`,
    }),
  noSongsToAdd: "Nenhuma música para adicionar",
  alreadyIn: (playlist: string): string => `Já está em ${playlist}`,
  allAlreadyIn: (count: number, playlist: string): string =>
    `As ${n(count)} músicas já estão em ${playlist}`,
  added: (count: number, playlist: string): string =>
    `${counted(count)} ${count === 1 ? "adicionada" : "adicionadas"} a ${playlist}`,
  someAlreadyIn: (count: number): string =>
    plural("pt-BR", count, {
      one: `${n(count)} já estava nela`,
      other: `${n(count)} já estavam nela`,
    }),
  deleteOne: (name: string): string => `Apagar ${name}?`,
  deleteMany: (count: number): string => `Apagar ${n(count)} playlists?`,
  itsSongsStay: "As músicas dela continuam na sua biblioteca.",
  theirSongsStay: "As músicas delas continuam na sua biblioteca.",
  delete: "Apagar",
  showAs: "Mostrar playlists como",
  chooseLayout: "Escolher como as playlists aparecem",
  showAndSort: "Mostrar e ordenar playlists",
  layouts: { list: "Lista", grid: "Grade", large: "Cartões Grandes" },
  sortBy: "Ordenar por",
  sorts: {
    name: "Nome",
    added: "Adicionadas Recentemente",
    played: "Tocadas Recentemente",
    custom: "Personalizada",
  },
  recommendedSongs: "Músicas recomendadas",
  loading: "Carregando…",
  loadingRecommended: "Carregando músicas recomendadas",
  loadingAnother: "Carregando outra recomendação",
  tryAgain: "Tentar Novamente",
  addRecommendation: (title: string): string => `Adicionar ${title} à playlist`,
  dismissRecommendation: (title: string): string => `Dispensar a recomendação ${title}`,
  adding: (title: string): string => `Adicionando ${title}`,
  dismissing: (title: string): string => `Dispensando ${title}`,
  addedSong: (title: string): string => `${title} adicionada à playlist.`,
  dismissedSong: (title: string): string => `${title} dispensada.`,
  couldntAddSong: (title: string): string =>
    `Não foi possível adicionar ${title}. Tente novamente.`,
  couldntDismissSong: (title: string): string =>
    `Não foi possível dispensar ${title}. Tente novamente.`,
  next: (title: string): string => `Próxima recomendação: ${title}.`,
  couldntLoadAnother: "Não foi possível carregar outra recomendação.",
  noMoreMatching: "Nenhuma outra música combina no momento.",
  recommendationsUpdated: "Recomendações atualizadas.",
  savedButNoAnother: "Sua escolha foi salva. Não foi possível carregar outra recomendação.",
  couldntSaveChoice: "Não foi possível salvar sua escolha. Tente a ação da música de novo.",
  couldntLoadRecommendations: "Não foi possível carregar as recomendações. Tente novamente.",
  addSongsForRecommendations: "Adicione músicas para receber recomendações para esta playlist.",
};
