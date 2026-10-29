import { plural } from "../plural.ts";
import { formatNumber } from "../formatting.ts";
export const autoEn = {
  home: "Home",
  playlists: "Playlists",
  albums: "Albums",
  artists: "Artists",
  recentlyPlayed: "Recently Played",
  mostPlayed: "Most Played",
  favorites: "Favorites",
  shuffle: "Shuffle",
  shuffleAll: "Shuffle all",
  noPlaylists: "No playlists yet",
  createPlaylist: "Create one in Wave on your phone",
  nothingPlayed: "Nothing played yet",
  albumsPlayed: "Albums you play show up here",
  noPlays: "No plays yet",
  songsPlayed: "Songs you play most show up here",
  noFavorites: "No favorites yet",
  songsStarred: "Songs you star show up here",
  notFound: "This is no longer in your library.",
  ytMusicOff: "YT Music is off in Settings.",
  couldNotLoad: "Wave couldn't load this. Try again in a moment.",
  songs: (count: number): string =>
    plural("en", count, {
      one: `${formatNumber("en", count)} song`,
      other: `${formatNumber("en", count)} songs`,
    }),
};
