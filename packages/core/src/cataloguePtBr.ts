import { homePtBr } from "./catalogue/homePtBr.ts";
/**
 * Wave's interface text in Brazilian Portuguese, entry for entry with
 * `catalogueEn.ts`. Terms follow the spec's glossary; until it's approved,
 * Apple Music's pt-BR wording.
 */

import type { Catalogue } from "./catalogueEn.ts";

export const ptBR: Catalogue = {
  home: homePtBr,
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
