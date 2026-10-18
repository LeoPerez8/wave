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
import * as Effect from "effect/Effect";

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

/** Lookups running at once: gentle on Deezer, whose open API limits bursts. */
const CONCURRENCY = 3;
/** The most artists one call looks up: the rest wait for the next pages or build. */
const MOST_LOOKUPS = 40;
/** A request that takes longer than this has failed. */
const REQUEST_TIMEOUT = "15 seconds";

const getJson = (url: string) =>
  Effect.tryPromise(async (signal) => {
    const response = await fetch(url, { signal });
    if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
    return (await response.json()) as unknown;
  }).pipe(Effect.timeout(REQUEST_TIMEOUT));

/** Deezer's genre names by id, read once per app session (again after a failure). */
let genreNames: ReadonlyMap<number, string> | null = null;

const genres = Effect.gen(function* () {
  if (genreNames !== null) return genreNames;
  const names = deezerGenreNames(yield* getJson(DEEZER_GENRES_URL));
  if (names === null) return yield* Effect.fail(new Error("Deezer didn't answer with genres"));
  genreNames = names;
  return names;
});

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

/**
 * Looks [artists] up on Deezer (40 at most, three at a time) and keeps what
 * it finds; an artist whose lookup fails stays unknown, and so do all of
 * them when Deezer's genres can't be read. Does nothing while the Lyrics
 * and genre switch is off. Never fails.
 */
export const lookUpArtistProfiles = (artists: readonly string[]) =>
  Effect.gen(function* () {
    if (artists.length === 0 || !lyricsAndGenreLookupsEnabled()) return;
    const names = yield* genres.pipe(Effect.orElseSucceed(() => null));
    if (names === null) return;
    const found = yield* Effect.forEach(
      artists.slice(0, MOST_LOOKUPS),
      (artist) =>
        lookUp(artist, names).pipe(
          Effect.map((profile) => [[artist, profile] as const]),
          Effect.orElseSucceed((): (readonly [string, GenreProfile | null])[] => []),
        ),
      { concurrency: CONCURRENCY },
    );
    const looked = found.flat();
    if (looked.length > 0) profiles.set(withArtistProfiles(profiles.get(), looked));
  });
