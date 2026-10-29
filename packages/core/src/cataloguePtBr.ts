import { downloadNoticePtBr } from "./catalogue/downloadNoticePtBr.ts";
import { nativePtBr } from "./catalogue/nativePtBr.ts";
import { autoPtBr } from "./catalogue/autoPtBr.ts";
import { playbackTextPtBr } from "./catalogue/playbackTextPtBr.ts";
import { lyricsLanguagesPtBr } from "./catalogue/lyricsLanguagesPtBr.ts";
import { showsPtBr } from "./catalogue/showsPtBr.ts";
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
  lyricsLanguages: lyricsLanguagesPtBr,
  playbackText: playbackTextPtBr,
  shows: showsPtBr,
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
    noAnswer: "Sem resposta online. Tente novamente em instantes.",
    hideFailed: "Não foi possível ocultar este lançamento. Tente novamente.",
    hide: "Ocultar",
    goToArtist: "Ir para Artista",
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
