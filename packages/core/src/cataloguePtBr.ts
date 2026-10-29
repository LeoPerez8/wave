import { libraryPtBr } from "./catalogue/libraryPtBr.ts";
import { playlistsPtBr } from "./catalogue/playlistsPtBr.ts";
import { importsPtBr } from "./catalogue/importsPtBr.ts";
import { homePtBr } from "./catalogue/homePtBr.ts";
import { arrangementPtBr } from "./catalogue/arrangementPtBr.ts";
import { discoverPtBr } from "./catalogue/discoverPtBr.ts";
import { statsPtBr } from "./catalogue/statsPtBr.ts";
import { recapPtBr } from "./catalogue/recapPtBr.ts";
import { listeningHistoryPtBr } from "./catalogue/listeningHistoryPtBr.ts";
import { sharePtBr } from "./catalogue/sharePtBr.ts";
import { downloadNoticePtBr } from "./catalogue/downloadNoticePtBr.ts";
import { nativePtBr } from "./catalogue/nativePtBr.ts";
import { autoPtBr } from "./catalogue/autoPtBr.ts";
import { playbackTextPtBr } from "./catalogue/playbackTextPtBr.ts";
import { lyricsLanguagesPtBr } from "./catalogue/lyricsLanguagesPtBr.ts";
import { showsPtBr } from "./catalogue/showsPtBr.ts";
import { upcomingShowsPtBr } from "./catalogue/upcomingShowsPtBr.ts";
import { settingsPtBr } from "./catalogue/settingsPtBr.ts";
import { downloadStatusPtBr } from "./catalogue/downloadStatusPtBr.ts";
import { alertPtBr } from "./catalogue/alertPtBr.ts";
import { fixSongsPtBr } from "./catalogue/fixSongsPtBr.ts";
import { downloadsPtBr } from "./catalogue/downloadsPtBr.ts";
import { itemActionsPtBr } from "./catalogue/itemActionsPtBr.ts";
import { songDeletionPtBr } from "./catalogue/songDeletionPtBr.ts";
/**
 * Wave's interface text in Brazilian Portuguese, entry for entry with
 * `catalogueEn.ts`. Terms follow the spec's glossary; until it's approved,
 * Apple Music's pt-BR wording.
 */

import type { Catalogue } from "./catalogueEn.ts";

export const ptBR: Catalogue = {
  downloadNotice: downloadNoticePtBr,
  native: nativePtBr,
  auto: autoPtBr,
  library: libraryPtBr,
  playlists: playlistsPtBr,
  imports: importsPtBr,
  lyricsLanguages: lyricsLanguagesPtBr,
  playbackText: playbackTextPtBr,
  shows: showsPtBr,
  upcomingShows: upcomingShowsPtBr,
  home: homePtBr,
  arrangement: arrangementPtBr,
  discover: discoverPtBr,
  stats: statsPtBr,
  recap: recapPtBr,
  listeningHistory: listeningHistoryPtBr,
  share: sharePtBr,
  settings: settingsPtBr,
  downloadStatus: downloadStatusPtBr,
  alert: alertPtBr,
  fixSongs: fixSongsPtBr,
  downloads: downloadsPtBr,
  itemActions: itemActionsPtBr,
  songDeletion: songDeletionPtBr,
  tabs: {
    index: "Início",
    library: "Biblioteca",
    search: "Buscar",
    playlists: "Playlists",
    artists: "Artistas",
    albums: "Álbuns",
    songs: "Músicas",
    genres: "Gêneros",
    favorites: "Favoritas",
  },
  newReleases: {
    title: "Novidades dos Artistas que Você Segue",
    single: "Single",
    ep: "EP",
    album: "Álbum",
    unavailable: "Ainda não está no YouTube Music",
    ytMusicOff: "O YT Music está desativado em Ajustes",
    noAnswer: "Sem resposta online. Tente novamente em instantes.",
    hideFailed: "Não foi possível ocultar este lançamento. Tente novamente.",
    hide: "Ocultar",
    goToArtist: "Ir para o Artista",
    addToPlaylist: "Adicionar à Playlist",
    today: "Hoje",
    yesterday: "Ontem",
    daysAgo: (days: number) => `Há ${days} dias`,
    absoluteDate: (month: number, day: number, year: number | null) =>
      `${day} de ${["jan.", "fev.", "mar.", "abr.", "mai.", "jun.", "jul.", "ago.", "set.", "out.", "nov.", "dez."][month - 1]}${year === null ? "" : ` de ${year}`}`,
  },
  followArtistSearch: {
    placeholder: "Buscar artistas para seguir",
    follow: "Seguir",
    following: "Seguindo",
    searching: "Buscando no Deezer…",
    unavailable:
      "Não foi possível acessar o Deezer. Os resultados da Biblioteca continuam disponíveis.",
    empty: "Nenhum artista encontrado.",
  },
  tabBar: {
    editHint: "Mantenha pressionado para editar a barra de abas",
    edit: "Editar a barra de abas",
  },
};
