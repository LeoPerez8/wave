import { createFindableList, playlistFindText } from "./findInPlaylist.ts";

/** Let the subject scroll when fixing it would leave less than one result row. */
export const playlistPickerSubjectScrolls = (input: {
  readonly searching: boolean;
  /** Height available to the heading, subject and entries above the keyboard, in dp. */
  readonly maxHeight: number;
  /** Measured heading and subject, with their padding and separator, in dp. */
  readonly fixedHeight: number;
  /** One result row at the current text size, in dp. */
  readonly entryHeight: number;
}): boolean => input.searching && input.maxHeight < input.fixedHeight + input.entryHeight;

/** Null means the title is showing; an empty string is an open, empty field. */
export const stepPlaylistPickerSearch = (
  query: string | null,
  action: "open" | "clear" | "back",
): { readonly query: string | null } => ({
  query:
    action === "open" || (action === "clear" && query !== null && query.length > 0) ? "" : null,
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
