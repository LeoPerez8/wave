import { createFindableList, playlistFindText } from "./findInPlaylist.ts";

/** Null means the title is showing; an empty string is an open, empty field. */
export const stepPlaylistPickerSearch = (
  query: string | null,
  action: "open" | "clear" | "back",
): { readonly query: string | null; readonly dismiss: boolean } => ({
  query:
    action === "open" || (action === "clear" && query !== null && query.length > 0) ? "" : null,
  dismiss: action === "back" && query === null,
});

/** Search only the names, preserving the order supplied by the picker. */
export const createPlaylistPickerSearch = <T extends { readonly name: string }>(
  playlists: readonly T[],
) => {
  const finder = createFindableList(playlists, (playlist) => playlistFindText(playlist.name), true);
  return {
    show: (query: string | null) => {
      const found = finder.show(query ?? "");
      return {
        playlists: found.songs,
        noMatch: found.found !== null && found.found.length === 0,
        showNewPlaylist: query === null || query.length === 0,
      };
    },
  };
};
