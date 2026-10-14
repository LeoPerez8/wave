/**
 * Find Lyrics and Genre (docs/spec.md, "Lyrics and genre"): looks a song up
 * online (lyrics on LRCLIB, genre on Deezer), writes what it finds into the
 * file (the native `writeLyricsAndGenre`) and updates its index entry. What is
 * sent, which result is the song and how a run went are Core's
 * (`lyricsAndGenre.ts`); this file fetches, writes and re-indexes.
 *
 * The pieces are separate so other features can reuse them: tagging a
 * downloaded file is `lookUpLyricsAndGenre` then `writeLyricsAndGenre`.
 */
import {
  LRCLIB_HEADERS,
  deezerAlbumGenre,
  deezerAlbumUrl,
  deezerTrackCandidates,
  deezerTrackSearchUrl,
  libraryLookupSongs,
  lookupsUnreachable,
  lrclibCandidates,
  lrclibSearchUrl,
  missingTags,
  pickFoundLyrics,
  pickGenreAlbum,
  settledTags,
  songLookup,
  songTagOutcome,
  type FoundTags,
  type IndexedLyricsAndGenre,
  type SongLookup,
  type SongTagOutcome,
  type TagLookup,
  type TagWriteReport,
} from "@wave/core";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";

import { WaveNative } from "@/native/waveNative";
import { lyricsAndGenreLookupsEnabled } from "@/settings/lyricsAndGenre";

import { libraryEdited, toIndexedArtwork, toIndexedTrack } from "./LibraryScan";
import { LibraryStore } from "./LibraryStore";
import { lyricsWritten } from "./lyricsEdits";

/** LRCLIB or Deezer couldn't be reached, or answered with something that isn't a result. */
export class LookupFailed extends Data.TaggedError("LookupFailed")<{ readonly cause: unknown }> {}

/** Settings turned lookups off: no request was made. */
export class LookupsOff extends Data.TaggedError("LookupsOff")<{}> {}

/** The file couldn't be written; it is left as it was. */
export class TagWriteFailed extends Data.TaggedError("TagWriteFailed")<{
  readonly cause: unknown;
}> {}

/** A song to find lyrics and genre for: its file, and what is sent about it. */
export interface TaggableSong {
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
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
  return response.json();
};

/** Deezer album genres already fetched in this app session, by album id: albums share them. */
const albumGenres = new Map<number, string | null>();

const findLyrics = async (song: SongLookup, signal: AbortSignal) => {
  const candidates = lrclibCandidates(await getJson(lrclibSearchUrl(song), signal, LRCLIB_HEADERS));
  if (candidates === null) throw new Error("LRCLIB didn't answer with search results");
  return pickFoundLyrics(song, candidates);
};

const findGenre = async (song: SongLookup, signal: AbortSignal): Promise<string | null> => {
  const tracks = deezerTrackCandidates(await getJson(deezerTrackSearchUrl(song), signal));
  if (tracks === null) throw new Error("Deezer didn't answer with search results");
  const albumId = pickGenreAlbum(song, tracks);
  if (albumId === null) return null;
  const known = albumGenres.get(albumId);
  if (known !== undefined) return known;
  const album = deezerAlbumGenre(await getJson(deezerAlbumUrl(albumId), signal));
  if (album === null) throw new Error("Deezer didn't answer with an album");
  albumGenres.set(albumId, album.genre);
  return album.genre;
};

/** One service's lookup, settled: what it answered, or that it failed (or took too long). */
const settle = <A>(find: (signal: AbortSignal) => Promise<A>): Effect.Effect<TagLookup<A>> =>
  Effect.tryPromise(find).pipe(
    Effect.timeout(LOOKUP_TIMEOUT),
    Effect.match({
      onSuccess: (value): TagLookup<A> => ({ ok: true, value }),
      onFailure: (cause): TagLookup<A> => {
        console.warn("[wave] lyrics and genre lookup failed", cause);
        return { ok: false };
      },
    }),
  );

/**
 * Looks [song] up online: its lyrics on LRCLIB (synced preferred) and its
 * album's genre on Deezer, matched by Core. Only the title, artist, album and
 * length are sent. Each service is settled on its own, so lyrics found survive
 * Deezer failing and the other way round (Core's `settledTags`). Finding
 * nothing is `{ lyrics: null, genre: null }`; fails with `LookupFailed` only
 * when neither service answered, and with `LookupsOff` (sending nothing) when
 * Settings turned lookups off.
 */
export const lookUpLyricsAndGenre = (
  song: SongLookup,
): Effect.Effect<FoundTags, LookupFailed | LookupsOff> =>
  lyricsAndGenreLookupsEnabled()
    ? Effect.all(
        [settle((signal) => findLyrics(song, signal)), settle((signal) => findGenre(song, signal))],
        { concurrency: "unbounded" },
      ).pipe(
        Effect.flatMap(([lyrics, genre]) => {
          const found = settledTags(lyrics, genre);
          return found === null
            ? Effect.fail(new LookupFailed({ cause: "Neither LRCLIB nor Deezer answered" }))
            : Effect.succeed(found);
        }),
      )
    : Effect.fail(new LookupsOff());

const NOTHING_WRITTEN: TagWriteReport = { lyrics: "none", genre: "none" };

/**
 * Writes [found] into the file at [path], replacing its lyrics and genre (a
 * format without tag writing gets a sidecar `.lrc`), then brings its index
 * entry up to date so Genres, Search and the Lyrics view show the new values
 * without a rescan. Finding nothing leaves the file untouched.
 */
export const writeLyricsAndGenre = (
  path: string,
  found: FoundTags,
): Effect.Effect<TagWriteReport, TagWriteFailed, LibraryStore> =>
  Effect.gen(function* () {
    if (found.lyrics === null && found.genre === null) return NOTHING_WRITTEN;
    const written = yield* Effect.tryPromise({
      try: () => WaveNative.writeLyricsAndGenre(path, found.lyrics?.text ?? null, found.genre),
      catch: (cause) => new TagWriteFailed({ cause }),
    });
    if (written.lyrics !== "none") lyricsWritten(path);
    if (written.track !== null) {
      const store = yield* LibraryStore;
      yield* store
        .saveBatch(
          [toIndexedTrack(written.track)],
          written.artwork === null ? [] : [toIndexedArtwork(written.artwork)],
        )
        // Drops a genre no song has any more.
        .pipe(
          Effect.andThen(store.removeTracks([])),
          Effect.ensuring(Effect.sync(libraryEdited)),
          // The file has its new tags; the next scan brings the index up to date.
          Effect.ignore,
        );
    }
    return { lyrics: written.lyrics, genre: written.genre };
  });

/**
 * Find Lyrics and Genre for one song: looks it up and writes what is found.
 * A failure is an outcome (the file is left as it was); only `LookupsOff` fails.
 */
export const findLyricsAndGenre = (
  song: TaggableSong,
): Effect.Effect<SongTagOutcome, LookupsOff, LibraryStore> =>
  Effect.gen(function* () {
    const lookup = songLookup(song);
    if (lookup === null) return { kind: "notFound" } as const;
    const found = yield* lookUpLyricsAndGenre(lookup);
    const written = yield* writeLyricsAndGenre(song.path, found);
    return songTagOutcome(found, written);
  }).pipe(
    Effect.catchTags({
      LookupFailed: () => Effect.succeed<SongTagOutcome>({ kind: "failed", reason: "lookup" }),
      TagWriteFailed: () => Effect.succeed<SongTagOutcome>({ kind: "failed", reason: "write" }),
    }),
  );

/**
 * Find Lyrics and Genre for a song just added to the Library (a download):
 * looks it up and writes only what its file still lacks, never replacing
 * lyrics or a genre it has. Never fails: a song left without them can still
 * be looked up from its menu.
 */
export const fillInLyricsAndGenre = (
  song: TaggableSong & IndexedLyricsAndGenre,
): Effect.Effect<void, never, LibraryStore> =>
  Effect.gen(function* () {
    if (libraryLookupSongs([song]).lookUp.length === 0) return;
    const lookup = songLookup(song);
    if (lookup === null) return;
    const found = yield* lookUpLyricsAndGenre(lookup);
    yield* writeLyricsAndGenre(song.path, missingTags(found, song));
  }).pipe(
    Effect.catch((error) =>
      Effect.sync(() =>
        console.warn(`[wave] couldn't fill in lyrics and genre for ${song.path}`, error),
      ),
    ),
  );

/** The least time one song takes in a run: keeps Deezer's requests under its rate limit. */
const SONG_MIN_MS = 250;

/**
 * Finds lyrics and genre for [songs], one after another, calling [onResult]
 * as each is done. Stops early (`unreachable`) when LRCLIB and Deezer can't be
 * reached (Core's `lookupsUnreachable`); interrupt it to cancel.
 */
export const findLyricsAndGenreForSongs = <S extends TaggableSong>(
  songs: readonly S[],
  onResult: (song: S, outcome: SongTagOutcome) => void,
): Effect.Effect<"done" | "unreachable", LookupsOff, LibraryStore> =>
  Effect.gen(function* () {
    const outcomes: SongTagOutcome[] = [];
    for (const song of songs) {
      const startedAt = Date.now();
      const outcome = yield* findLyricsAndGenre(song);
      outcomes.push(outcome);
      onResult(song, outcome);
      if (lookupsUnreachable(outcomes)) return "unreachable" as const;
      const spent = Date.now() - startedAt;
      if (spent < SONG_MIN_MS) yield* Effect.sleep(SONG_MIN_MS - spent);
    }
    return "done" as const;
  });
