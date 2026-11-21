/**
 * Import Playlists › From Spotify (`window.wave.spotifyImport`): the picker's rows and Import.
 * Main reads the account and makes the playlists; the window ticks rows and shows what came back.
 */
import type { YtLibraryFailureView, YtLibraryRow } from "@wave/core";
import type { Invoke } from "./bridge.ts";

/** What From Spotify opens with. */
export type SpotifyImportLibrary =
  /** The account's Liked Songs, then its playlists, each ticked unless imported before. */
  | { readonly status: "ready"; readonly rows: readonly YtLibraryRow[] }
  /** Why the library wasn't read, with Try Again, Sign In Again or nothing to offer. */
  | ({ readonly status: "failed" } & YtLibraryFailureView)
  /** The sign-in was cancelled: there is nothing to show. */
  | { readonly status: "signedOut" };

/** What Import did. */
export interface SpotifyImportResult {
  /** The playlists made or refreshed, in the picker's order. */
  readonly imported: readonly { readonly playlistId: number; readonly name: string }[];
  /** How many picked playlists Spotify wouldn't give. */
  readonly skipped: number;
  /** Why the import stopped before the last one, when it did. */
  readonly failure: YtLibraryFailureView | null;
}

/** A song of a playlist the Library lacks: not looked up yet, not found online, or a local file on Spotify. */
export interface MissingImportSong {
  readonly title: string;
  readonly artist: string;
  readonly state: "unsearched" | "notFound" | "localFile";
}

/** The most missing songs a playlist's page lists. */
export const MISSING_SONGS_SHOWN = 200;

/** A playlist's songs the Library lacks, in the playlist's order. */
export interface MissingImportSongs {
  readonly total: number;
  /** The first `MISSING_SONGS_SHOWN` of them. */
  readonly songs: readonly MissingImportSong[];
  /** YT Music is being asked for the ones not looked up yet. */
  readonly finding: boolean;
}

/** The most rows one Import names. */
export const SPOTIFY_IMPORT_MOST = 10_000;

export interface SpotifyImportContract {
  /** Reads the picker's rows; signed out it signs in first, and with [signIn] after an ended session too. */
  readonly "spotifyImport.library": {
    readonly args: readonly [signIn: boolean];
    readonly result: SpotifyImportLibrary;
  };
  /** Imports the listed rows [sources] name; [download] also queues the songs the Library lacks. */
  readonly "spotifyImport.run": {
    readonly args: readonly [sources: readonly string[], download: boolean];
    readonly result: SpotifyImportResult;
  };
  /** Stops the import under way after the playlist it is reading. */
  readonly "spotifyImport.cancel": { readonly args: readonly []; readonly result: void };
  /** A playlist's songs the Library lacks; the ones not looked up yet are looked up from here on. */
  readonly "spotifyImport.missing": {
    readonly args: readonly [playlistId: number];
    readonly result: MissingImportSongs;
  };
  /** A listed row's cover as a data URL, or null. */
  readonly "spotifyImport.artwork": {
    readonly args: readonly [source: string];
    readonly result: string | null;
  };
}

export const SPOTIFY_IMPORT_CALLS = [
  "spotifyImport.library",
  "spotifyImport.run",
  "spotifyImport.cancel",
  "spotifyImport.artwork",
  "spotifyImport.missing",
] as const;

export const spotifyImportBridge = (invoke: Invoke) => ({
  library: (signIn: boolean) => invoke("spotifyImport.library", signIn),
  run: (sources: readonly string[], download: boolean) =>
    invoke("spotifyImport.run", sources, download),
  cancel: () => invoke("spotifyImport.cancel"),
  artwork: (source: string) => invoke("spotifyImport.artwork", source),
  missing: (playlistId: number) => invoke("spotifyImport.missing", playlistId),
});
