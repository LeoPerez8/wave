/**
 * Importing playlists from the signed-in account's YouTube Music library
 * (docs/spec.md, "Importing playlists from a link", From YT Music): the
 * picker's rows and ticks, and the playlists Import makes. The app reads the
 * library page and each playlist; Core decides what's listed, what's ticked
 * and what each playlist is named.
 */

import { counted } from "./listening.ts";
import { importNameClash, importedPlaylistName, keepBothName } from "./m3u.ts";
import type { YtQuietReason } from "./ytSearch.ts";

/**
 * Who a playlist in the account's library comes from: the account made it,
 * saved it from someone else, or YouTube Music generates it (Liked Music,
 * Episodes for Later, Supermix and the other mixes, podcasts).
 */
export type YtLibraryPlaylistKind = "own" | "saved" | "generated";

/** A playlist on the account's library page (`FEmusic_liked_playlists`), as the native parser reads it. */
export interface YtLibraryPlaylist {
  /** YouTube's playlist id, without `VL`. */
  readonly playlistId: string;
  readonly title: string;
  readonly artworkUrl: string | null;
  /** How many songs the library page says it has; null when it doesn't say. */
  readonly songCount: number | null;
  readonly kind: YtLibraryPlaylistKind;
}

/** One of the picker's rows: a playlist to import, ticked or not. */
export interface YtLibraryRow {
  /** The YouTube Music playlist Import reads, without `VL`. */
  readonly playlistId: string;
  /** Its name on YouTube Music. */
  readonly title: string;
  readonly artworkUrl: string | null;
  /** "N songs", from the library page; null when it doesn't say. */
  readonly line: string | null;
  readonly ticked: boolean;
}

/** The From YT Music picker: its rows in the order they show. */
export interface YtLibraryPicker {
  readonly rows: readonly YtLibraryRow[];
}

/**
 * The picker for the account's library [playlists], in YouTube Music's order:
 * the account's own and saved playlists, every row ticked. What YouTube Music
 * generates is left out.
 */
export const ytLibraryPicker = (playlists: readonly YtLibraryPlaylist[]): YtLibraryPicker => ({
  rows: playlists
    .filter((playlist) => playlist.kind !== "generated")
    .map(({ playlistId, title, artworkUrl, songCount }) => ({
      playlistId,
      title,
      artworkUrl,
      line: songCount === null ? null : counted(songCount, "song"),
      ticked: true,
    })),
});

/** [picker] with the row for [playlistId] ticked if it wasn't, unticked if it was. */
export const toggleYtLibraryRow = (
  picker: YtLibraryPicker,
  playlistId: string,
): YtLibraryPicker => ({
  ...picker,
  rows: picker.rows.map((row) =>
    row.playlistId === playlistId ? { ...row, ticked: !row.ticked } : row,
  ),
});

/** What the picker offers around its rows. */
export interface YtLibraryPickerView {
  /**
   * The button above the list: Select All while any row is unticked,
   * Deselect All once all are; none without rows.
   */
  readonly selectAll: "Select All" | "Deselect All" | null;
  /** Whether Import does anything: some row is ticked. */
  readonly canImport: boolean;
}

export const ytLibraryPickerView = ({ rows }: YtLibraryPicker): YtLibraryPickerView => ({
  selectAll:
    rows.length === 0 ? null : rows.every((row) => row.ticked) ? "Deselect All" : "Select All",
  canImport: rows.some((row) => row.ticked),
});

/** The Select All / Deselect All button: every row ticked, or, when all were, none. */
export const pressYtLibrarySelectAll = (picker: YtLibraryPicker): YtLibraryPicker => {
  const tick = !picker.rows.every((row) => row.ticked);
  return { ...picker, rows: picker.rows.map((row) => ({ ...row, ticked: tick })) };
};

/** One playlist Import makes: the YouTube Music playlist it's read from, and its Wave name. */
export interface YtLibraryImportItem {
  /** Without `VL`. */
  readonly playlistId: string;
  /** Its name in Wave, free of every other playlist's. */
  readonly name: string;
}

/**
 * The playlists Import makes from [picker], one per ticked row in its order,
 * each named as a link import names it (`importedPlaylistName`). A name one
 * of [playlists] (or an earlier one of these) has goes in under Keep Both's
 * name ("Name 2"), without asking.
 */
export const planYtLibraryImport = (
  picker: YtLibraryPicker,
  playlists: readonly { readonly name: string }[],
): readonly YtLibraryImportItem[] => {
  const taken = playlists.map((playlist) => ({ name: playlist.name }));
  const items: YtLibraryImportItem[] = [];
  for (const row of picker.rows) {
    if (!row.ticked) continue;
    const wanted = importedPlaylistName(row.title);
    const name =
      importNameClash(wanted, taken) === undefined
        ? wanted
        : keepBothName(
            wanted,
            taken.map((playlist) => playlist.name),
          );
    taken.push({ name });
    items.push({ playlistId: row.playlistId, name });
  }
  return items;
};

/**
 * Why the library page wasn't read: offline, YouTube Music failed, YT Music
 * turned off meanwhile, or the session ended (YouTube stopped accepting it,
 * or answered as to someone signed out).
 */
export type YtLibraryFailure = YtQuietReason | "disabled" | "signedOut";

/** What the picker shows in place of its rows when the library page wasn't read. */
export interface YtLibraryFailureView {
  readonly line: string;
  /** Try Again, Sign In Again, or nothing to offer. */
  readonly action: "tryAgain" | "signIn" | null;
}

const FAILURES: Record<YtLibraryFailure, YtLibraryFailureView> = {
  offline: { line: "You're offline. Try again when you're back online.", action: "tryAgain" },
  failed: {
    line: "Couldn't read your YouTube Music library. YouTube Music didn't answer.",
    action: "tryAgain",
  },
  signedOut: {
    line: "Your YouTube session ended. Sign in again to see your playlists.",
    action: "signIn",
  },
  disabled: { line: "YT Music is off in Settings.", action: null },
};

/** The picker's message for a library page that wasn't read, and what it offers. */
export const ytLibraryFailure = (reason: YtLibraryFailure): YtLibraryFailureView =>
  FAILURES[reason];
