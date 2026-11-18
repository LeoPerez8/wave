/**
 * The calls between main and the JVM (`packages/kotlin-shared/stdio`), one JSON object per line:
 *
 *   main -> jvm  {"id":1,"method":"readTags","params":{"path":"..."}}
 *   jvm  -> main {"id":1,"result":...}  or  {"id":1,"error":{"code":"ERR_...","message":"..."}}
 *   jvm  -> main {"id":"j1","method":"poToken","params":{...}}  (main answers the same way)
 *   jvm  -> main {"event":"ready","java":"21..."}
 *
 * Error codes are the phone's (`ERR_YT_*`, `ERR_SLSK_*`, `ERR_UNEXPECTED`) plus the JVM's own
 * (`ERR_BAD_REQUEST`, `ERR_UNKNOWN_METHOD`, `ERR_BAD_PARAMS`, `ERR_HOST`, `ERR_HOST_TIMEOUT`).
 */
import type { SongTags } from "../../shared/tags.ts";

/** What main can ask the JVM, as `WaveDesktop.handle` answers it. */
export interface KotlinMethods extends KotlinDownloadMethods {
  /** An audio file's tags. */
  readonly readTags: { readonly params: { readonly path: string }; readonly result: SongTags };
  /** YouTube Music's Songs search, its first page (`YtSearchPage.toMap`). */
  readonly search: { readonly params: { readonly query: string }; readonly result: unknown };
  /**
   * Where a song's audio is fetched from (`YtStreamResolver`); `fresh` skips the cached address.
   * The address and headers are the session's: never logged.
   */
  readonly resolveStream: {
    readonly params: { readonly videoId: string; readonly fresh?: boolean };
    readonly result: {
      readonly url: string;
      readonly headers: Readonly<Record<string, string>>;
      readonly mimeType: string;
      readonly itag: number;
      readonly contentLength: number | null;
      readonly expiresAtMs: number;
      readonly loudnessDb: number | null;
    } | null;
  };
  /** A track's lyrics as found: in its tags and in a sidecar `.lrc` (`LyricsReader`). */
  readonly readLyrics: {
    readonly params: { readonly path: string };
    readonly result: { readonly embedded: string | null; readonly sidecar: string | null };
  };
  /** YT Music's lyrics for a song (plain text), or null when it has none. */
  readonly ytLyrics: {
    readonly params: { readonly videoId: string };
    readonly result: string | null;
  };
  /** Turns YT Music on or off in the JVM; its calls then fail with `ERR_YT_DISABLED`. */
  readonly setYtMusic: { readonly params: { readonly enabled: boolean }; readonly result: null };
  /** Fix Songs' tag write (`SongTagWriter`): what was written, or `{failed}` with the step. */
  readonly "tags.writeSong": {
    readonly params: {
      readonly path: string;
      readonly lyrics: string | null;
      readonly genre: string | null;
      readonly trackNumber: number | null;
      readonly discNumber: number | null;
      readonly year: number | null;
      readonly advisory: number | null;
    };
    readonly result: Readonly<Record<string, unknown>>;
  };
}

/**
 * The download journal (`DurableDownloads`), YT Music's pages a download's tags come from and
 * Soulseek (Download in best quality), as `WaveDesktop.downloadCall` answers them. The results
 * are the journal's maps; `downloads/` reads them.
 */
export interface KotlinDownloadMethods {
  readonly "downloads.enqueueAll": {
    readonly params: {
      readonly requests: readonly {
        readonly song: object;
        readonly recording: object;
        /** The unfinished job this song shares, as another result id of the same recording. */
        readonly equivalentId?: string | null;
        readonly source: string | null;
        readonly origin: object | null;
      }[];
    };
    readonly result: readonly string[];
  };
  readonly "downloads.snapshot": { readonly params: object; readonly result: readonly unknown[] };
  readonly "downloads.changes": {
    readonly params: { readonly revision: number };
    readonly result: {
      readonly revision: number;
      /** Each job that changed since. */
      readonly jobs: readonly unknown[];
      /** Every job's id, when the order changed since; else null. */
      readonly ids: readonly string[] | null;
    };
  };
  readonly "downloads.claim": {
    readonly params: { readonly id: string };
    readonly result: unknown;
  };
  readonly "downloads.renew": {
    readonly params: { readonly id: string; readonly generation: number; readonly token: string };
    readonly result: boolean;
  };
  readonly "downloads.submit": {
    readonly params: {
      readonly id: string;
      readonly generation: number;
      readonly token: string;
      readonly decision: string;
      readonly payload: object;
    };
    readonly result: boolean;
  };
  readonly "downloads.forgetCompleted": {
    readonly params: { readonly id: string; readonly generation: number };
    readonly result: boolean;
  };
  readonly "downloads.refreshPolicy": {
    readonly params: { readonly roots: readonly string[]; readonly excluded: readonly string[] };
    readonly result: number;
  };
  readonly "downloads.cancel": { readonly params: { readonly id: string }; readonly result: null };
  readonly "downloads.move": {
    readonly params: { readonly ids: readonly string[] };
    readonly result: null;
  };
  readonly "downloads.start": { readonly params: object; readonly result: null };
  readonly "downloads.stop": { readonly params: object; readonly result: null };
  readonly "download.album": {
    readonly params: { readonly browseId: string };
    readonly result: unknown;
  };
  readonly "download.watchSong": {
    readonly params: { readonly videoId: string };
    readonly result: { readonly albumId: string | null; readonly lyricsBrowseId: string | null };
  };
  readonly "download.lyrics": {
    readonly params: { readonly browseId: string };
    readonly result: string | null;
  };
  readonly "soulseek.session": { readonly params: object; readonly result: SoulseekSession };
  readonly "soulseek.turnOn": { readonly params: object; readonly result: SoulseekSession };
  readonly "soulseek.turnOff": { readonly params: object; readonly result: SoulseekSession };
  readonly "soulseek.search": {
    readonly params: { readonly query: string };
    readonly result: readonly unknown[];
  };
}

/** Download in best quality's account, as `SoulseekClient.session` answers it. */
export interface SoulseekSession {
  readonly status: "off" | "disconnected" | "connected";
  readonly username: string | null;
}

export type KotlinMethod = keyof KotlinMethods;
export type KotlinDownloadMethod = keyof KotlinDownloadMethods;

/**
 * What the JVM can ask main, by method: each gets the request's params and answers its result,
 * or throws (an `Error` with a string `code` keeps it).
 */
export type HostMethods = Readonly<Record<string, (params: unknown) => Promise<unknown>>>;

/** Something the JVM tells main unasked, such as `ready`. */
export interface KotlinEvent {
  readonly event: string;
  readonly [field: string]: unknown;
}
