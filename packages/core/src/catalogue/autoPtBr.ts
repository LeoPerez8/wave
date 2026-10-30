import { plural } from "../plural.ts";
import { formatNumber } from "../formatting.ts";
import type { autoEn } from "./autoEn.ts";
export const autoPtBr: typeof autoEn = {
  home: "Início",
  playlists: "Playlists",
  albums: "Álbuns",
  artists: "Artistas",
  recentlyPlayed: "Tocadas Recentemente",
  mostPlayed: "Mais Tocadas",
  favorites: "Favoritas",
  shuffle: "Aleatório",
  shuffleAll: "Tudo em Aleatório",
  noPlaylists: "Nenhuma playlist ainda",
  createPlaylist: "Crie uma no Wave pelo celular",
  nothingPlayed: "Nada foi reproduzido ainda",
  albumsPlayed: "Os álbuns que você reproduzir aparecem aqui",
  noPlays: "Nenhuma reprodução ainda",
  songsPlayed: "As músicas mais tocadas aparecem aqui",
  noFavorites: "Nenhuma favorita ainda",
  songsStarred: "As músicas que você favoritar aparecem aqui",
  notFound: "Este item não está mais na biblioteca.",
  ytMusicOff: "YT Music está desativado nos Ajustes.",
  couldNotLoad: "Não foi possível carregar. Tente novamente em instantes.",
  songs: (count: number): string =>
    plural("pt-BR", count, {
      zero: "Nenhuma música",
      one: `${formatNumber("pt-BR", count)} música`,
      other: `${formatNumber("pt-BR", count)} músicas`,
    }),
};
