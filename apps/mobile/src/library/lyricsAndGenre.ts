/**
 * Fix Song (docs/spec.md, "Lyrics and genre"): looks up online what a song
 * lacks (lyrics on LRCLIB; genre, track number, year and explicit flag on
 * Deezer), writes
 * what it finds into the file (the native `writeLyricsAndGenre`) and updates
 * its index entry. Which songs it's for, which requests are made, which
 * result is the song, what gets written and how a run went are Core's
 * (`lyricsAndGenre.ts`); this file fetches, writes and re-indexes.
 *
 * The pieces are separate so other features can reuse them: tagging a
 * downloaded file is `lookUpLyricsAndGenre` then `writeLyricsAndGenre`.
 */
import {
  LRCLIB_HEADERS,
  advisoryTag,
  deezerAlbum,
  deezerAlbumTracks,
  deezerAlbumTracksUrl,
  deezerAlbumUrl,
  deezerTags,
  deezerTrackCandidates,
  deezerTrackSearchUrl,
  canFixSong,
  deezerFollowUps,
  fixLookups,
  lookupsUnreachable,
  lrclibCandidates,
  lrclibSearchUrl,
  lookupFailureLine,
  missingTags,
  pickDeezerTrack,
  pickFoundLyrics,
  settledTags,
  songLookup,
  songTagOutcome,
  tagWriteFailureLine,
  type DeezerAlbum,
  type DeezerAlbumTrack,
  type DeezerTags,
  type FoundLyrics,
  type FoundTags,
  type IndexedTags,
  type LookupService,
  type SongLookup,
  type SongTagOutcome,
  type TagLookup,
  type TagWriteFile,
  type TagWriteOrigin,
  type TagWriteReport,
  type TagWriteStep,
} from "@wave/core";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";

import { WaveNative } from "@/native/waveNative";
import { lyricsAndGenreLookupsEnabled } from "@/settings/lyricsAndGenre";

import { libraryEdited, songsLanded, toIndexedArtwork, toIndexedTrack } from "./LibraryScan";
import { publishSavedStars } from "./libraryChanges";
import { LibraryStore } from "./LibraryStore";
import { lyricsWritten } from "./lyricsEdits";

/** LRCLIB or Deezer couldn't be reached, or answered with something that isn't a result. */
export class LookupFailed extends Data.TaggedError("LookupFailed")<{ readonly cause: unknown }> {}

/** Settings turned lookups off: no request was made. */
// oxlint-disable-next-line typescript/no-empty-object-type -- Effect TaggedError uses {} for a tag-only error with no fields.
export class LookupsOff extends Data.TaggedError("LookupsOff")<{}> {}

/**
 * The file couldn't be written; it is left as it was. [step] and [file] are
 * what the native writer said (Core's `TagWriteFailure`), null when it didn't.
 */
export class TagWriteFailed extends Data.TaggedError("TagWriteFailed")<{
  readonly cause: unknown;
  readonly step: TagWriteStep | null;
  readonly file: TagWriteFile | null;
}> {}

/** The native exception a tag write failed with: its Java class is its name. */
class NativeTagWriteError extends Error {
  constructor(exception: string, message: string) {
    super(message);
    this.name = exception;
  }
}

/** A request answered with an HTTP error: the log line says its status. */
class HttpStatusError extends Error {
  readonly status: number;
  constructor(status: number, url: string) {
    super(`HTTP ${status} for ${url}`);
    this.name = "HttpStatusError";
    this.status = status;
  }
}

/** A song to fix: its file, what is sent about it, and what it already has. */
export interface TaggableSong extends IndexedTags {
  readonly path: string;
  readonly title: string;
  readonly artist: string;
  readonly album: string;
  readonly durationMs: number;
}

/** A lookup (every request it makes) that takes longer than this has failed. */
const LOOKUP_TIMEOUT = "30 seconds";

const getJson = async (
  url: string,
  signal: AbortSignal,
  headers?: Record<string, string>,
): Promise<unknown> => {
  const response = await fetch(url, { signal, headers });
  if (!response.ok) throw new HttpStatusError(response.status, url);
  return response.json();
};

/** Deezer albums (genre and year) already fetched in this app session, by album id: songs share them. */
const deezerAlbums = new Map<number, DeezerAlbum>();
/** Deezer album tracklists already fetched in this app session, by album id. */
const deezerTracklists = new Map<number, readonly DeezerAlbumTrack[]>();

const findLyrics = async (song: SongLookup, signal: AbortSignal) => {
  const candidates = lrclibCandidates(await getJson(lrclibSearchUrl(song), signal, LRCLIB_HEADERS));
  if (candidates === null) throw new Error("LRCLIB didn't answer with search results");
  return pickFoundLyrics(song, candidates);
};

const findAlbum = async (albumId: number, signal: AbortSignal): Promise<DeezerAlbum> => {
  const known = deezerAlbums.get(albumId);
  if (known !== undefined) return known;
  const album = deezerAlbum(await getJson(deezerAlbumUrl(albumId), signal));
  if (album === null) throw new Error("Deezer didn't answer with an album");
  deezerAlbums.set(albumId, album);
  return album;
};

/** [albumId]'s tracklist, or null when Deezer doesn't give it: the genre and year still count. */
const findTracklist = async (
  albumId: number,
  signal: AbortSignal,
): Promise<readonly DeezerAlbumTrack[] | null> => {
  const known = deezerTracklists.get(albumId);
  if (known !== undefined) return known;
  try {
    const tracklist = deezerAlbumTracks(await getJson(deezerAlbumTracksUrl(albumId), signal));
    if (tracklist !== null) deezerTracklists.set(albumId, tracklist);
    return tracklist;
  } catch (cause) {
    if (signal.aborted) throw cause;
    console.warn(`[wave] ${lookupFailureLine("Deezer album tracklist lookup", "Deezer", cause)}`);
    return null;
  }
};

/**
 * What Deezer says about [song] (Core's `deezerTags`) that a song with [has]
 * lacks: its album (genre and year) and that album's tracklist (track number)
 * are fetched only when Core's `deezerFollowUps` says they could fill
 * something in, each once per album and session.
 */
const findDeezerTags = async (
  song: SongLookup,
  has: IndexedTags,
  signal: AbortSignal,
): Promise<DeezerTags | null> => {
  const tracks = deezerTrackCandidates(await getJson(deezerTrackSearchUrl(song), signal));
  if (tracks === null) throw new Error("Deezer didn't answer with search results");
  const match = pickDeezerTrack(song, tracks);
  if (match === null) return null;
  const next = deezerFollowUps(has, match);
  const album = next.album ? await findAlbum(match.albumId, signal) : null;
  const tracklist = next.tracklist ? await findTracklist(match.albumId, signal) : null;
  return deezerTags(match, album, tracklist);
};

/**
 * One service's lookup, settled: what it answered, or that it failed (or took
 * too long), logged with the service and the original error.
 */
const settle = <A>(
  service: LookupService,
  find: (signal: AbortSignal) => Promise<A>,
): Effect.Effect<TagLookup<A>> =>
  Effect.tryPromise(find).pipe(
    Effect.timeout(LOOKUP_TIMEOUT),
    Effect.match({
      onSuccess: (value): TagLookup<A> => ({ ok: true, value }),
      onFailure: (cause): TagLookup<A> => {
        console.warn(`[wave] ${lookupFailureLine("Fix Song lookup", service, cause)}`);
        return { ok: false };
      },
    }),
  );

/**
 * [song]'s lyrics on LRCLIB alone, matched as Fix Song matches them (Core's
 * `pickFoundLyrics`: synced preferred, within 2 s of its length); null when
 * LRCLIB has none. Fails with `LookupFailed` when LRCLIB can't be reached in
 * time, and with `LookupsOff` (sending nothing) when Settings turned lookups
 * off. The Lyrics view's search for a non-D song.
 */
export const searchLrclibLyrics = (
  song: SongLookup,
): Effect.Effect<FoundLyrics | null, LookupFailed | LookupsOff> => {
  if (!lyricsAndGenreLookupsEnabled()) return Effect.fail(new LookupsOff());
  return Effect.tryPromise({
    try: (signal) => findLyrics(song, signal),
    catch: (cause) => new LookupFailed({ cause }),
  }).pipe(
    Effect.timeout(LOOKUP_TIMEOUT),
    // Taking too long is failing.
    Effect.mapError((error) =>
      error instanceof LookupFailed ? error : new LookupFailed({ cause: error }),
    ),
  );
};

/** A download's fill-in saved [trackIds]: it lands as its import did. */
const landedFillIn = (trackIds: readonly number[] = []): void => songsLanded(trackIds);

/** A song with nothing yet (a download being tagged): everything is looked up. */
const HAS_NOTHING: IndexedTags = {
  hasLyrics: false,
  genre: null,
  trackNumber: null,
  year: null,
  explicit: "unknown",
};

/**
 * Looks [song] up online for what a song with [has] lacks (Core's
 * `fixLookups`): its lyrics on LRCLIB (synced preferred) and, on Deezer, its
 * album's genre and year, its track number there and whether it's explicit
 * (the matched track's flag, from the search itself), matched by Core. A
 * service whose answer couldn't fill anything isn't asked. Only the title,
 * artist, album and length are sent. Each service is settled on its own, so
 * lyrics found survive Deezer failing and the other way round (Core's
 * `settledTags`). Finding nothing is all nulls; fails with `LookupFailed`
 * only when no service asked answered, and with `LookupsOff` (sending
 * nothing) when Settings turned lookups off.
 */
export const lookUpLyricsAndGenre = (
  song: SongLookup,
  has: IndexedTags = HAS_NOTHING,
): Effect.Effect<FoundTags, LookupFailed | LookupsOff> => {
  if (!lyricsAndGenreLookupsEnabled()) return Effect.fail(new LookupsOff());
  const ask = fixLookups(has);
  return Effect.all(
    [
      ask.lyrics ? settle("LRCLIB", (signal) => findLyrics(song, signal)) : Effect.succeed(null),
      ask.deezer
        ? settle("Deezer", (signal) => findDeezerTags(song, has, signal))
        : Effect.succeed(null),
    ],
    { concurrency: "unbounded" },
  ).pipe(
    Effect.flatMap(([lyrics, deezer]) => {
      const found = settledTags(lyrics, deezer);
      return found === null
        ? Effect.fail(new LookupFailed({ cause: "Neither LRCLIB nor Deezer answered" }))
        : Effect.succeed(found);
    }),
  );
};

const NOTHING_WRITTEN: TagWriteReport = {
  lyrics: "none",
  genre: "none",
  trackNumber: "none",
  year: "none",
  explicit: "none",
};

/**
 * Writes [found] into the file at [path], replacing its lyrics and genre (a
 * format without tag writing gets a sidecar `.lrc`) and filling in its track
 * number, disc, year and advisory tag (Core's `advisoryTag`; the file keeps
 * any it has), then brings its index entry up to date so Genres, Search, the
 * album page, the Lyrics view and the E badge show the new values without a
 * rescan. Finding nothing leaves the file untouched. [announce] tells the
 * lists of the updated entry (its track, once saved): an edit by default, a
 * landing for a download's fill-in (`songsLanded`). A failure is logged with
 * why (Core's `tagWriteFailureLine`: the step, the file, the song's [origin]
 * and the native exception); an index update failing is logged and left to
 * the next scan.
 */
export const writeLyricsAndGenre = (
  path: string,
  found: FoundTags,
  origin: TagWriteOrigin,
  announce: (trackIds?: readonly number[]) => void = libraryEdited,
): Effect.Effect<TagWriteReport, TagWriteFailed, LibraryStore> =>
  Effect.gen(function* () {
    const { lyrics, genre, trackNumber, discNumber, year } = found;
    const advisory = advisoryTag(found.explicit);
    if (
      lyrics === null &&
      genre === null &&
      trackNumber === null &&
      year === null &&
      advisory === null
    )
      return NOTHING_WRITTEN;
    const written = yield* Effect.tryPromise({
      try: () =>
        WaveNative.writeLyricsAndGenre(
          path,
          lyrics?.text ?? null,
          genre,
          trackNumber,
          // The disc goes with the number it belongs to.
          trackNumber === null ? null : discNumber,
          year,
          advisory,
        ),
      catch: (cause) => new TagWriteFailed({ cause, step: null, file: null }),
    });
    if ("failed" in written) {
      const { step, exception, message, fileExists, fileBytes } = written.failed;
      return yield* new TagWriteFailed({
        cause: new NativeTagWriteError(exception, message),
        step,
        file: { exists: fileExists, bytes: fileBytes },
      });
    }
    if (written.lyrics !== "none") lyricsWritten(path);
    if (written.track !== null) {
      const store = yield* LibraryStore;
      let saved: readonly number[] | undefined;
      yield* store
        .saveBatch(
          [toIndexedTrack(written.track)],
          written.artwork === null ? [] : [toIndexedArtwork(written.artwork)],
          [],
          // Its title, artists and length are as they were: no entry links to it now.
          { linkEntries: false },
        )
        // Drops a genre no song has any more.
        .pipe(
          Effect.tap(({ starred, trackIds }) =>
            Effect.sync(() => {
              saved = trackIds;
              publishSavedStars(starred);
            }),
          ),
          Effect.andThen(store.filesGone([])),
          Effect.ensuring(Effect.sync(() => announce(saved))),
          // The file has its new tags; the next scan brings the index up to date.
          Effect.catch((cause) =>
            Effect.sync(() =>
              logTagWriteFailure(
                path,
                origin,
                new TagWriteFailed({ cause, step: "reindex", file: null }),
              ),
            ),
          ),
        );
    }
    return {
      lyrics: written.lyrics,
      genre: written.genre,
      trackNumber: written.trackNumber,
      year: written.year,
      explicit: written.explicit,
    };
  }).pipe(
    Effect.tapError((failure) => Effect.sync(() => logTagWriteFailure(path, origin, failure))),
  );

const logTagWriteFailure = (path: string, origin: TagWriteOrigin, failure: TagWriteFailed): void =>
  console.warn(
    `[wave] ${tagWriteFailureLine({ path, origin, step: failure.step, file: failure.file, cause: failure.cause })}`,
  );

/** What Deezer adds when nothing is written but lyrics. */
const NOTHING_FROM_DEEZER = {
  genre: null,
  trackNumber: null,
  discNumber: null,
  year: null,
  explicit: "unknown",
} as const;

/**
 * Writes [lyrics] found online into the file at [path] as Fix Song writes
 * them (its tags, or a sidecar `.lrc` for a format without tag writing),
 * and nothing else. The Lyrics view's search for a Library song.
 */
export const writeFoundLyrics = (
  path: string,
  lyrics: FoundLyrics,
): Effect.Effect<TagWriteReport, TagWriteFailed, LibraryStore> =>
  writeLyricsAndGenre(path, { lyrics, ...NOTHING_FROM_DEEZER }, "lyricsSearch");

/**
 * Fix Song for one song: looks up what it lacks and writes only that (Core's
 * `missingTags`), never replacing lyrics, a genre, a track number, a year or
 * an explicit flag it has. A song with nothing missing (Core's `canFixSong`) makes no request. A
 * failure is an outcome (the file is left as it was; a failed write is logged
 * with the song's [origin]); only `LookupsOff` fails.
 */
const fixSong = (
  song: TaggableSong,
  origin: TagWriteOrigin,
  announce?: (trackIds?: readonly number[]) => void,
): Effect.Effect<SongTagOutcome, LookupsOff, LibraryStore> =>
  Effect.gen(function* () {
    const lookup = canFixSong(song) ? songLookup(song) : null;
    if (lookup === null) return { kind: "notFound" } as const;
    const found = missingTags(yield* lookUpLyricsAndGenre(lookup, song), song);
    const written = yield* writeLyricsAndGenre(song.path, found, origin, announce);
    return songTagOutcome(found, written);
  }).pipe(
    Effect.catchTags({
      LookupFailed: () => Effect.succeed<SongTagOutcome>({ kind: "failed", reason: "lookup" }),
      TagWriteFailed: () => Effect.succeed<SongTagOutcome>({ kind: "failed", reason: "write" }),
    }),
  );

/**
 * Fix Song on a song just added to the Library (a download, or a quality
 * replacement's new copy: [origin], Core's `downloadTagWriteOrigin`),
 * quietly: it gets what its file still lacks. Never fails: a song left
 * incomplete can still be fixed from its menu. What it writes lands as the
 * download did (`songsLanded`), joining its import's change while that still
 * waits. A failed write is logged with why (`writeLyricsAndGenre`); a failed
 * lookup, by each service's line and this.
 */
export const fillInLyricsAndGenre = (
  song: TaggableSong,
  origin: TagWriteOrigin,
): Effect.Effect<void, never, LibraryStore> =>
  fixSong(song, origin, landedFillIn).pipe(
    Effect.flatMap((outcome) =>
      Effect.sync(() => {
        if (outcome.kind === "failed" && outcome.reason === "lookup")
          console.warn(`[wave] couldn't fill in ${song.path} (lookup)`);
      }),
    ),
    Effect.catch((error) =>
      Effect.sync(() => console.warn(`[wave] couldn't fill in ${song.path}`, error)),
    ),
  );

/**
 * The least time one song takes in a run: keeps Deezer's requests under its
 * rate limit (50 every 5 seconds) with up to three per song (search, album,
 * tracklist; the explicit flag comes with the search).
 */
const SONG_MIN_MS = 400;

/**
 * Fix Song on [songs], one after another, calling [onResult] as each is done.
 * Stops early (`unreachable`) when LRCLIB and Deezer can't be reached (Core's
 * `lookupsUnreachable`); interrupt it to cancel.
 */
export const fixEachSong = <S extends TaggableSong>(
  songs: readonly S[],
  onResult: (song: S, outcome: SongTagOutcome) => void,
): Effect.Effect<"done" | "unreachable", LookupsOff, LibraryStore> =>
  Effect.gen(function* () {
    const outcomes: SongTagOutcome[] = [];
    for (const song of songs) {
      const startedAt = Date.now();
      const outcome = yield* fixSong(song, "fixSong");
      outcomes.push(outcome);
      onResult(song, outcome);
      if (lookupsUnreachable(outcomes)) return "unreachable" as const;
      const spent = Date.now() - startedAt;
      if (spent < SONG_MIN_MS) yield* Effect.sleep(SONG_MIN_MS - spent);
    }
    return "done" as const;
  });
