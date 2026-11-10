/**
 * Export to YT Music (docs/spec.md, "Exporting to YT Music"): Wave's
 * playlists go to the signed-in YouTube Music account, the way Share sends
 * one (`matchSharedSongs`, `syncSharedPlaylist`), each as a private playlist
 * that exporting again updates. What's here is the picker (its rows, ticks
 * and Select All), the playlists an Export sends and in what order, and the
 * line that sums it up. The app reads the playlists and sends them.
 */

import { catalogueOf, type AppLanguage } from "./localisation.ts";
import type { SharedSongs } from "./playlistShare.ts";
import { isSpotifyLibrarySource } from "./spotifyLibrary.ts";
import type { YtLibraryOrigins } from "./ytLibrary.ts";

/** A Wave playlist as the export picker lists it. */
export interface YtExportPlaylist {
  readonly id: number;
  readonly name: string;
  readonly trackCount: number;
}

/** One of the export picker's rows: a Wave playlist to send, ticked or not. */
export interface YtExportRow<P extends YtExportPlaylist = YtExportPlaylist> {
  readonly kind: "playlist";
  /** What a tap toggles it by. */
  readonly key: string;
  readonly playlist: P;
  /** "N songs". */
  readonly line: string;
  /** It came From YT Music (an origin in `ytLibraryOrigins`), so it starts unticked. */
  readonly fromYtMusic: boolean;
  readonly ticked: boolean;
}

/** The Export to YT Music picker: its rows in the order they show. */
export interface YtExportPicker<P extends YtExportPlaylist = YtExportPlaylist> {
  readonly rows: readonly YtExportRow<P>[];
}

const NO_ORIGINS: YtLibraryOrigins = new Map();

/**
 * The picker for the Wave [playlists], in the order given (the Playlists
 * list's): every one ticked but those [origins] say came From YT Music,
 * which would go back where they came from. Spotify imports are ticked.
 */
export const ytExportPicker = <P extends YtExportPlaylist>(
  playlists: readonly P[],
  origins: YtLibraryOrigins = NO_ORIGINS,
  language: AppLanguage = "en",
): YtExportPicker<P> => {
  const fromYtMusic = new Set(
    [...origins].flatMap(([source, id]) => (isSpotifyLibrarySource(source) ? [] : [id])),
  );
  const { imports } = catalogueOf(language);
  return {
    rows: playlists.map((playlist) => {
      const imported = fromYtMusic.has(playlist.id);
      return {
        kind: "playlist",
        key: `playlist:${playlist.id}`,
        playlist,
        line: imports.songs(playlist.trackCount),
        fromYtMusic: imported,
        ticked: !imported,
      };
    }),
  };
};

/** [picker] with the row [key] ticked if it wasn't, unticked if it was. */
export const toggleYtExportRow = <P extends YtExportPlaylist>(
  picker: YtExportPicker<P>,
  key: string,
): YtExportPicker<P> => ({
  ...picker,
  rows: picker.rows.map((row) => (row.key === key ? { ...row, ticked: !row.ticked } : row)),
});

/** The Select All / Deselect All button: every row ticked, or, when all were, none. */
export const pressYtExportSelectAll = <P extends YtExportPlaylist>(
  picker: YtExportPicker<P>,
): YtExportPicker<P> => {
  const tick = !picker.rows.every((row) => row.ticked);
  return { ...picker, rows: picker.rows.map((row) => ({ ...row, ticked: tick })) };
};

/** What the export picker offers around its rows. */
export interface YtExportPickerView {
  /** Select All while any row is unticked, Deselect All once all are; none without rows. */
  readonly selectAll: "Select All" | "Deselect All" | null;
  /** Whether Export does anything: some row is ticked. */
  readonly canExport: boolean;
}

export const ytExportPickerView = ({ rows }: YtExportPicker): YtExportPickerView => ({
  selectAll:
    rows.length === 0 ? null : rows.every((row) => row.ticked) ? "Deselect All" : "Select All",
  canExport: rows.some((row) => row.ticked),
});

/** One playlist an Export sends: the Wave playlist, and its name as the picker showed it. */
export interface YtExportItem {
  readonly kind: "playlist";
  readonly playlistId: number;
  readonly name: string;
}

/** What Export sends for [picker]: its ticked playlists, one at a time in the picker's order. */
export const planYtExport = (picker: YtExportPicker): YtExportItem[] =>
  picker.rows.flatMap((row) =>
    row.ticked ? [{ kind: "playlist", playlistId: row.playlist.id, name: row.playlist.name }] : [],
  );

/** What an Export did: the playlists it sent, and how many of their songs were found on YT Music. */
export interface YtExportSummary {
  readonly playlists: number;
  readonly found: number;
  readonly total: number;
}

/** Nothing exported yet. */
export const NO_YT_EXPORT: YtExportSummary = { playlists: 0, found: 0, total: 0 };

/** [summary] with one more playlist sent, whose songs were [shared] (`matchSharedSongs`). */
export const addYtExported = (
  summary: YtExportSummary,
  shared: Pick<SharedSongs, "found" | "total">,
): YtExportSummary => ({
  playlists: summary.playlists + 1,
  found: summary.found + shared.found,
  total: summary.total + shared.total,
});

/** The toast that ends an Export: "8 playlists exported · 412 of 430 songs found". */
export const ytExportSummaryLine = (
  { playlists, found, total }: YtExportSummary,
  language: AppLanguage = "en",
): string => {
  const strings = catalogueOf(language);
  return `${strings.imports.exportedPlaylists(playlists)} · ${strings.share.found(found, total)}`;
};
