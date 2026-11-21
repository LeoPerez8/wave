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
export interface KotlinMethods extends KotlinDownloadMethods, KotlinRecognizeMethods {
  /** A playlist of the signed-in account: its privacy and entries, or null when it is gone. */
  readonly ownPlaylist: {
    readonly params: { readonly playlistId: string };
    readonly result: {
      readonly privacy: string | null;
      readonly entries: readonly { readonly videoId: string; readonly setVideoId: string }[];
    } | null;
  };
  /** Makes a playlist on the signed-in account; its id. */
  readonly createPlaylist: {
    readonly params: {
      readonly title: string;
      readonly videoIds: readonly string[];
      readonly privacy: "UNLISTED";
    };
    readonly result: string;
  };
  /** Edits a playlist of the signed-in account (`YtPlaylistEdit.of`). */
  readonly editPlaylist: {
    readonly params: {
      readonly playlistId: string;
      readonly edits: readonly Record<string, string | null>[];
    };
    readonly result: null;
  };
  /**
   * Signs YT Music in with the session the browser sign-in read (`yt/ytBrowserSignIn.ts`); the
   * account's session (`YtSessionState.toMap`). The JVM keeps the cookie with main
   * (`ytSession.save`), never in a file of its own.
   */
  readonly ytSignIn: {
    readonly params: {
      readonly cookie: string;
      readonly dataSyncId?: string;
      readonly sessionIndex: string;
    };
    readonly result: unknown;
  };
  /** Forgets the YouTube session; signed out. */
  readonly ytSignOut: { readonly params: object; readonly result: unknown };
  /** The YouTube session as kept, without asking YouTube. */
  readonly ytSession: { readonly params: object; readonly result: unknown };
  /** The YouTube session after asking YouTube whether it still accepts it. */
  readonly ytCheckSession: { readonly params: object; readonly result: unknown };
  /** The signed-in account's library playlists (`YtLibraryPlaylist.toMap`). */
  readonly libraryPlaylists: { readonly params: object; readonly result: unknown };
  /** A playlist's first page (`YtPlaylist.toMap`). */
  readonly playlist: { readonly params: { readonly playlistId: string }; readonly result: unknown };
  /** A playlist's next page. */
  readonly playlistMore: {
    readonly params: { readonly continuation: string };
    readonly result: unknown;
  };
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
  /** YouTube Music's pages (`YtPages`), parsed in main by `yt/ytPages.ts`. */
  readonly artist: { readonly params: { readonly browseId: string }; readonly result: unknown };
  readonly album: { readonly params: { readonly browseId: string }; readonly result: unknown };
  readonly searchArtists: { readonly params: { readonly query: string }; readonly result: unknown };
  readonly searchAlbums: { readonly params: { readonly query: string }; readonly result: unknown };
  readonly songRadio: { readonly params: { readonly videoId: string }; readonly result: unknown };
  readonly artistRadio: {
    readonly params: { readonly browseId: string };
    readonly result: unknown;
  };
  readonly radioMore: {
    readonly params: { readonly continuation: string };
    readonly result: unknown;
  };
  readonly related: { readonly params: { readonly videoId: string }; readonly result: unknown };
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
  /** The pause on YouTube's downloads the journal keeps, across restarts too; null for none. */
  readonly "downloads.youtubePause": {
    readonly params: object;
    readonly result: { readonly until: number; readonly level: number } | null;
  };
  /** YouTube's jobs wait until [until] (epoch ms; 0 lifts the pause), as Core's `ytThrottle` decided. */
  readonly "downloads.pauseYoutube": {
    readonly params: { readonly until: number; readonly level: number };
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

/**
 * Recognize (`DesktopRecognize.kt`) over audio main sends: the JVM signs it and asks Shazam. It
 * tells main `recognizeHeard` `{session, heardMs, audible}` and `recognizeCaptureFailed` `{session}`.
 */
export interface KotlinRecognizeMethods {
  /** A session under main's id, replacing any other; `locale` is the app's language. */
  readonly "recognize.start": {
    readonly params: { readonly session: number; readonly locale?: string };
    readonly result: number;
  };
  /** The session's next audio: 16 kHz mono 16-bit little-endian PCM, in base64. */
  readonly "recognize.audio": {
    readonly params: { readonly session: number; readonly pcm: string };
    readonly result: null;
  };
  /** The capture stopped on its own: the JVM reports it as `recognizeCaptureFailed`. */
  readonly "recognize.end": {
    readonly params: { readonly session: number };
    readonly result: null;
  };
  /** Shazam's answer about the latest [windowMs] heard (Core's `RecognizeAnswer`). */
  readonly "recognize.ask": {
    readonly params: {
      readonly session: number;
      readonly last: boolean;
      readonly windowMs: number;
    };
    readonly result: unknown;
  };
  readonly "recognize.stop": {
    readonly params: { readonly session: number };
    readonly result: null;
  };
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
