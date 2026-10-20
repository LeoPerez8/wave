/**
 * The genre profiles of radio artists outside the Library (docs/spec.md,
 * "Artist mixes", genre affinity): from the genres of their albums on
 * Deezer's open API, looked up once and kept on the phone, and only while
 * the Lyrics and genre switch is on. What a profile is, which artists to
 * look up and how a mix uses them are Core's (`genreAffinity.ts`).
 */
import {
  DEEZER_GENRES_URL,
  artistProfilesKnown,
  deezerArtistAlbumsUrl,
  deezerArtistId,
  deezerArtistProfile,
  deezerArtistSearchUrl,
  deezerGenreNames,
  libraryGenreProfiles,
  parseArtistProfiles,
  storedArtistProfiles,
  withArtistProfiles,
  type ArtistProfiles,
  type GenreProfile,
  type GenreProfileLibrary,
  type GenreProfileOf,
} from "@wave/core";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Semaphore from "effect/Semaphore";

import { countAnswer } from "@/lib/networkMeter";
import { persistedSetting } from "@/lib/persistedSetting";
import { lyricsAndGenreLookupsEnabled } from "@/settings/lyricsAndGenre";

/** The profiles looked up so far, kept on this phone (not synced). */
const profiles = persistedSetting<ArtistProfiles>({
  key: "home.mixArtistProfiles",
  read: parseArtistProfiles,
  write: (value) => (value.size === 0 ? null : storedArtistProfiles(value)),
  persistDelayMs: 2000,
});

/** An outside artist's profile as looked up so far: undefined when never looked up. */
export const lookedUpProfileOf: GenreProfileOf = (artist) =>
  artistProfilesKnown(profiles.get())(artist);

/**
 * Every artist's genre profile by name, as mixes and the Magic Queue weigh
 * radio songs (Core's `libraryGenreProfiles`): a Library artist's from
 * their songs in [library], an outside artist's as Deezer gave it.
 */
export const mixProfileOf = (library: GenreProfileLibrary): GenreProfileOf => {
  const ofLibrary = libraryGenreProfiles(library);
  return (artist) => {
    const own = ofLibrary(artist);
    return own === undefined ? lookedUpProfileOf(artist) : own;
  };
};

/**
 * Every artist's genre profile by name, as the Magic Queue holds both its
 * sources to the seed's genres: a Library artist's from their songs in
 * [library] when those have a genre, else (an outside artist, or a Library
 * artist whose songs have no genre tag) as Deezer gave it.
 */
export const magicProfileOf = (library: GenreProfileLibrary): GenreProfileOf => {
  const ofLibrary = libraryGenreProfiles(library);
  return (artist) => ofLibrary(artist) ?? lookedUpProfileOf(artist);
};

/**
 * Lookups running at once, across every build and Magic Queue batch going
 * on: gentle on Deezer, whose open API limits bursts.
 */
const CONCURRENCY = 3;
const lookups = Semaphore.makeUnsafe(CONCURRENCY);
/** A request that takes longer than this has failed. */
const REQUEST_TIMEOUT = "15 seconds";

/** Deezer's answer at [url], counted on the run being measured (`countAnswer`). */
const getJson = (url: string) =>
  Effect.tryPromise(async (signal) => {
    const response = await fetch(url, { signal });
    return { response, body: await response.text() };
  }).pipe(
    Effect.tap(({ response, body }) =>
      countAnswer("deezer", response.headers.get("content-length"), body),
    ),
    Effect.flatMap(({ response, body }) =>
      Effect.try(() => {
        if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
        return JSON.parse(body) as unknown;
      }),
    ),
    Effect.timeout(REQUEST_TIMEOUT),
  );

/** Deezer's genre names by id, read once per app session (again after a failure). */
let genreNames: ReadonlyMap<number, string> | null = null;

/** One read of the genres at a time, so calls made at once read them once. */
const genresRead = Semaphore.makeUnsafe(1);

const genres = Effect.gen(function* () {
  if (genreNames !== null) return genreNames;
  const names = deezerGenreNames(yield* getJson(DEEZER_GENRES_URL));
  if (names === null) return yield* Effect.fail(new Error("Deezer didn't answer with genres"));
  genreNames = names;
  return names;
}).pipe(genresRead.withPermits(1));

/**
 * [artist]'s profile from Deezer: null when Deezer has no such artist or no
 * genre for their albums; fails when Deezer can't be reached or answers
 * with something else, so it's tried again on a later build.
 */
const lookUp = (artist: string, names: ReadonlyMap<number, string>) =>
  Effect.gen(function* () {
    const id = deezerArtistId(yield* getJson(deezerArtistSearchUrl(artist)), artist);
    if (id === undefined) return yield* Effect.fail(new Error("Not a search result"));
    if (id === null) return null;
    const profile = deezerArtistProfile(yield* getJson(deezerArtistAlbumsUrl(id)), names);
    if (profile === undefined) return yield* Effect.fail(new Error("Not a list of albums"));
    return profile;
  });

/** Looks [artists] up now, three at a time across every call, and keeps what it finds. */
const lookUpNow = (artists: readonly string[]) =>
  Effect.gen(function* () {
    if (artists.length === 0) return;
    const names = yield* genres.pipe(Effect.orElseSucceed(() => null));
    if (names === null) return;
    const found = yield* Effect.forEach(
      artists,
      (artist) =>
        lookUp(artist, names).pipe(
          lookups.withPermits(1),
          Effect.map((profile) => [[artist, profile] as const]),
          Effect.orElseSucceed((): (readonly [string, GenreProfile | null])[] => []),
        ),
      { concurrency: "unbounded" },
    );
    const looked = found.flat();
    if (looked.length > 0) profiles.set(withArtistProfiles(profiles.get(), looked));
  });

/**
 * The artists being looked up now, till what was found is kept: a call
 * that asks for one of them (mixes built at once share radio artists)
 * waits for that lookup rather than making it again.
 */
const looking = new Map<string, Deferred.Deferred<void>>();

/**
 * Looks [artists] up on Deezer (three at a time across every call going
 * on: which ones and how many is Core's, `mixProfileLookupsNext`) and
 * keeps what it finds; an artist whose lookup fails stays
 * unknown, and so do all of them when Deezer's genres can't be read. An
 * artist another call is looking up is waited for, not looked up again.
 * Does nothing while the Lyrics and genre switch is off. Never fails.
 */
export const lookUpArtistProfiles = (artists: readonly string[]) =>
  Effect.gen(function* () {
    if (artists.length === 0 || !lyricsAndGenreLookupsEnabled()) return;
    const others = new Set(artists.flatMap((artist) => looking.get(artist) ?? []));
    const mine = artists.filter((artist) => !looking.has(artist));
    const done = Deferred.makeUnsafe<void>();
    for (const artist of mine) looking.set(artist, done);
    yield* lookUpNow(mine).pipe(
      Effect.ensuring(
        Effect.sync(() => {
          for (const artist of mine) looking.delete(artist);
          Deferred.doneUnsafe(done, Effect.void);
        }),
      ),
    );
    yield* Effect.forEach(others, Deferred.await, { discard: true });
  });
