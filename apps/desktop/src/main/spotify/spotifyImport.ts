/**
 * Import Playlists › From Spotify (docs/spec.md, "Importing playlists from a link", From
 * Spotify): the picker's rows read from the account with Spotify's Web API, and Import, which
 * makes a Wave playlist of each one picked as a Spotify link import does. Every request is sent
 * here, as the account of `SpotifyAccount`; the window gets rows and results, never a token.
 */
import type { LibraryDatabase } from "@wave/client/db/database";
import {
  createPlaylist,
  replacePlaylistSongs,
  selectPlaylistEntries,
  selectPlaylists,
  settleUnsearchedEntries,
} from "@wave/client/db/playlists";
import { trackQuery } from "@wave/client/db/tracks";
import { isCollaborative, refuseCollaborative } from "../library/collaborativePlaylists.ts";
import {
  catalogueOf,
  joinArtists,
  finishPlaylistImport,
  liveYtLibraryOrigins,
  planLinkImport,
  planYtLibraryImport,
  readSpotifyWebLibrary,
  readSpotifyWebPlaylist,
  readYtLibraryOrigins,
  settleUnsearched,
  spotifyLibraryFailure,
  spotifyLibraryPicker,
  spotifySignInFailureLines,
  startPlaylistImport,
  unsearchedSearchQuery,
  writeYtLibraryOrigins,
  ytLibraryFailure,
  type AppLanguage,
  type SpotifyLibraryPlaylist,
  type SpotifyWebAsk,
  type YtAlbumSong,
  type YtLibraryOrigins,
} from "@wave/core";
import {
  MISSING_SONGS_SHOWN,
  type MissingImportSong,
  type MissingImportSongs,
  type SpotifyImportLibrary,
  type SpotifyImportResult,
} from "../../shared/spotifyImport.ts";
import type { DownloadsShape } from "../downloads/downloads.ts";
import { readRemoteImage } from "../library/remoteImage.ts";
import { preference, savePreference } from "../preferences.ts";
import type { YtMusicShape } from "../yt/ytMusic.ts";
import type { SpotifyAccountService } from "./spotifyAccount.ts";

/** Which source each imported playlist came from, on this computer only (the phone's key). */
const ORIGINS = "ytLibraryOrigins";
/** The longest Spotify may ask Wave to wait before a request is tried again. */
const LONGEST_WAIT_S = 10;
const COVER_BYTES = 2_000_000;
const COVER_TIMEOUT_MS = 15_000;
/** After a YT Music search with no answer, how long the songs wait to be looked up again. */
const FIND_AGAIN_MS = 60_000;

/** A cover on one of Spotify's image servers, over HTTPS. */
const spotifyImage = (address: string): string | null => {
  const url = URL.parse(address);
  if (
    url === null ||
    url.protocol !== "https:" ||
    url.username !== "" ||
    url.password !== "" ||
    url.port !== ""
  )
    return null;
  const host = url.hostname;
  return host.endsWith(".scdn.co") || host.endsWith(".spotifycdn.com") ? url.href : null;
};

/** A song as its row names it. */
const listedSong = (song: { readonly title: string; readonly artists: readonly string[] }) => ({
  title: song.title,
  artist: joinArtists(song.artists),
});

export interface SpotifyImportDeps {
  readonly db: LibraryDatabase;
  readonly account: Pick<SpotifyAccountService, "session" | "signIn" | "request" | "view">;
  readonly yt: Pick<YtMusicShape, "enabled" | "search" | "keep">;
  readonly downloads: Pick<DownloadsShape, "yt" | "missingAction">;
  /** A playlist was made, filled or had a song found: the window reads its lists again. */
  readonly changed: () => void;
  /** Reads covers; without it the picker shows none. */
  readonly fetch?: typeof globalThis.fetch;
  readonly now?: () => number;
  readonly wait?: (ms: number) => Promise<void>;
}

export interface SpotifyImportShape {
  /**
   * The picker's rows. Signed out, it signs in first; with [signIn] (Sign In Again) an ended
   * session does too.
   */
  readonly library: (signIn: boolean, language: AppLanguage) => Promise<SpotifyImportLibrary>;
  /** Imports the rows [sources] name, of those `library` listed last, in the picker's order. */
  readonly run: (
    sources: readonly string[],
    download: boolean,
    language: AppLanguage,
  ) => Promise<SpotifyImportResult>;
  /** Stops the import under way after the playlist it is reading. */
  readonly cancel: () => void;
  /** The cover of the listed row [source] as a data URL, or null. */
  readonly artwork: (source: string) => Promise<string | null>;
  /**
   * The songs of [playlistId] the Library lacks, as its page lists them. Those not looked up
   * yet are looked up on YT Music from here on, each taking its place in the playlist when found.
   */
  readonly missing: (playlistId: number) => MissingImportSongs;
  /** Settles once no song is being looked up. */
  readonly idle: () => Promise<void>;
}

export const createSpotifyImport = (deps: SpotifyImportDeps): SpotifyImportShape => {
  const { db, account } = deps;
  const now = deps.now ?? Date.now;
  const wait =
    deps.wait ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  /** The library `library` read last: what `run`'s sources name. */
  let listed: readonly SpotifyLibraryPlaylist[] | null = null;
  let running = false;
  let cancelled = false;
  /** The playlists whose songs are being looked up on YT Music, one at a time. */
  const finding = new Set<number>();
  let finder: Promise<void> = Promise.resolve();
  /** When the songs may be looked up again, after a search that had no answer. */
  let findAgainAt = 0;

  /**
   * Looks up each song of [playlistId] the Library lacks on YT Music: the one found takes its
   * unsearched entry's place, one not found stays as an unavailable entry. With [download]
   * (Import & Download) the songs the Library lists without a file download as the playlist's
   * Download Missing Songs asks, and each song found joins them. A search with no answer leaves
   * the rest for later.
   */
  const find = (playlistId: number, download: boolean): void => {
    finding.add(playlistId);
    finder = finder.then(async () => {
      try {
        if (download)
          await deps.downloads.missingAction("downloadAll", { kind: "playlist", id: playlistId });
        for (const entry of selectPlaylistEntries(db, playlistId)) {
          if (entry.source !== "unsearched") continue;
          if (!deps.yt.enabled()) break;
          const search = await deps.yt.search(unsearchedSearchQuery(entry.song));
          if (search.status !== "ok") {
            findAgainAt = now() + FIND_AGAIN_MS;
            break;
          }
          const settled = settleUnsearched(entry.song, { ok: true, songs: search.songs });
          if (settled.kind === "failed") break;
          settleUnsearchedEntries(db, entry.song, settled.becomes, now());
          deps.changed();
          if (settled.kind !== "found") continue;
          deps.yt.keep([settled.becomes.song]);
          if (download) await deps.downloads.yt([settled.becomes.song.videoId]);
        }
      } catch {
        // The playlist was deleted meanwhile, or the downloads refused: the rest stays as it is.
      } finally {
        finding.delete(playlistId);
        deps.changed();
      }
    });
  };

  const ask: SpotifyWebAsk = async (path) => {
    for (let attempt = 0; ; attempt += 1) {
      const result = await account.request(path);
      if (result.status === "offline" || result.status === "failed")
        return { ok: false, reason: result.status };
      if (result.status !== "response") return { ok: false, reason: "signedOut" };
      const { response } = result;
      if (response.status === 429 && attempt === 0) {
        const seconds = Number(response.headers.get("retry-after") ?? Number.NaN);
        if (seconds >= 0 && seconds <= LONGEST_WAIT_S) {
          void response.body?.cancel().catch(() => {});
          await wait(seconds * 1_000);
          continue;
        }
      }
      // A playlist Spotify no longer has, or won't give this account: Wave goes on without it.
      if (response.status === 403 || response.status === 404) {
        void response.body?.cancel().catch(() => {});
        return { ok: false, reason: "missing" };
      }
      if (!response.ok) {
        void response.body?.cancel().catch(() => {});
        return { ok: false, reason: "failed" };
      }
      const data: unknown = await response.json().catch(() => undefined);
      return data === undefined ? { ok: false, reason: "failed" } : { ok: true, data };
    }
  };

  /** The origins of the playlists that still exist: a deleted one forgets where it came from. */
  const origins = (): YtLibraryOrigins =>
    liveYtLibraryOrigins(
      readYtLibraryOrigins(preference(db, ORIGINS) ?? null),
      selectPlaylists(db),
    );

  const failure = (
    reason: Parameters<typeof spotifyLibraryFailure>[0],
    language: AppLanguage,
  ): SpotifyImportLibrary => ({
    status: "failed",
    ...spotifyLibraryFailure(reason, language),
  });

  const library: SpotifyImportShape["library"] = async (signIn, language) => {
    const text = catalogueOf(language, "desktop");
    if (!deps.yt.enabled()) return { status: "failed", ...ytLibraryFailure("disabled", language) };
    if (!account.view().configured)
      return { status: "failed", line: text.desktopAccount.spotifyUnavailable, action: null };
    let { status } = account.session();
    if (status === "signedOut" || (signIn && status === "expired")) {
      await account.signIn();
      ({ status } = account.session());
      if (status !== "signedIn") {
        const view = account.view().account;
        const note = view.kind === "signedOut" ? view.note : "optional";
        if (note !== "optional" && note !== "expired")
          return {
            status: "failed",
            line: spotifySignInFailureLines(text)[note],
            action: "signIn",
          };
      }
    }
    if (status === "signedOut") return { status: "signedOut" };
    if (status === "expired") return failure("signedOut", language);
    const read = await readSpotifyWebLibrary(ask);
    if (!read.ok) return failure(read.reason, language);
    listed = read.playlists;
    return {
      status: "ready",
      rows: spotifyLibraryPicker(read.playlists, origins(), language).rows,
    };
  };

  const run: SpotifyImportShape["run"] = async (sources, download, language) => {
    if (!deps.yt.enabled()) throw new Error("YT Music is off");
    if (listed === null) throw new Error("No Spotify library to import from");
    if (running) throw new Error("An import from Spotify is under way");
    const wanted = new Set(sources);
    const picker = spotifyLibraryPicker(listed, origins(), language);
    const rows = picker.rows.map((row) => ({ ...row, ticked: wanted.has(row.playlistId) }));
    if (rows.filter((row) => row.ticked).length !== wanted.size)
      throw new Error("The picker listed no such playlist");
    const items = planYtLibraryImport({ ...picker, rows }, selectPlaylists(db));
    const tracks = trackQuery(db, "files").all();
    const imported: { playlistId: number; name: string }[] = [];
    let skipped = 0;
    let stopped: SpotifyImportResult["failure"] = null;
    running = true;
    cancelled = false;
    try {
      for (const item of items) {
        if (cancelled) break;
        const read = await readSpotifyWebPlaylist(
          { source: item.playlistId, title: item.name },
          ask,
        );
        if (cancelled) break;
        if (!read.ok) {
          if (read.reason === "missing") {
            skipped += 1;
            continue;
          }
          const { line, action } = spotifyLibraryFailure(read.reason, language);
          stopped = { line, action };
          break;
        }
        const plan = planLinkImport<YtAlbumSong, (typeof tracks)[number]>(
          { service: "spotify", playlist: read.playlist },
          tracks,
        );
        const { songs } = finishPlaylistImport(
          startPlaylistImport(plan, { playlistId: item.replaces ?? 0, name: item.name }),
        );
        let made: { readonly playlistId: number; readonly name: string };
        try {
          if (item.replaces === null) made = createPlaylist(db, item.name, songs, now());
          else {
            // A collaborative playlist is never replaced from the desktop: it is skipped.
            refuseCollaborative(db, item.replaces);
            replacePlaylistSongs(db, item.replaces, songs, now());
            made = { playlistId: item.replaces, name: item.name };
          }
        } catch {
          // Its name was taken, its playlist deleted meanwhile, or it is collaborative.
          skipped += 1;
          continue;
        }
        savePreference(
          db,
          ORIGINS,
          writeYtLibraryOrigins(new Map(origins()).set(item.playlistId, made.playlistId)),
        );
        imported.push({ playlistId: made.playlistId, name: made.name });
        deps.changed();
        find(made.playlistId, download);
      }
    } finally {
      running = false;
    }
    return { imported, skipped, failure: stopped };
  };

  return {
    library,
    run,
    cancel: () => {
      cancelled = true;
    },
    missing: (playlistId) => {
      let entries: ReturnType<typeof selectPlaylistEntries>;
      try {
        entries = selectPlaylistEntries(db, playlistId);
      } catch {
        entries = [];
      }
      const songs = entries.flatMap((entry): MissingImportSong[] =>
        entry.source === "unsearched"
          ? [{ ...listedSong(entry.song), state: "unsearched" }]
          : entry.source === "unavailable"
            ? [{ ...listedSong(entry.song), state: entry.song.reason }]
            : [],
      );
      if (
        songs.some((song) => song.state === "unsearched") &&
        deps.yt.enabled() &&
        !finding.has(playlistId) &&
        now() >= findAgainAt &&
        // The songs found would change a collaborative playlist's entries.
        !isCollaborative(db, playlistId)
      )
        find(playlistId, false);
      return {
        total: songs.length,
        songs: songs.slice(0, MISSING_SONGS_SHOWN),
        finding: finding.has(playlistId),
      };
    },
    idle: () => finder,
    artwork: async (source) => {
      const address = listed?.find((playlist) => playlist.source === source)?.artworkUrl ?? null;
      const url = address === null ? null : spotifyImage(address);
      if (url === null || deps.fetch === undefined) return null;
      return readRemoteImage(deps.fetch, url, COVER_BYTES, AbortSignal.timeout(COVER_TIMEOUT_MS));
    },
  };
};
