/** Known genre profiles and their affinity; recommendation ranking treats unknown genre as neutral. */
import { artistPhotoName } from "./artistPhoto.ts";
import type { DiscoverLibrarySong, DiscoverSeedArtist } from "./discoverMixes.ts";
import { songFamilies } from "./genreMixes.ts";
import { isRecord, readStoredRecord } from "./storedJson.ts";
import { libraryArtistFinderSteps, libraryArtistFinder } from "./ytArtist.ts";

/**
 * An artist's genre profile: each genre family's share of their songs (by
 * the family's key), the shares adding up to 1.
 */
export type GenreProfile = ReadonlyMap<string, number>;

/** Something tagged with a genre: a song, or an album on Deezer. */
export type GenreTagged = Pick<DiscoverLibrarySong, "genre" | "genres">;

/** Adds [song]'s families to [weights], 1/n to each of its n; whether it has any. */
const weighFamilies = (weights: Map<string, number>, song: GenreTagged): boolean => {
  const families = songFamilies(song);
  for (const family of families)
    weights.set(family.key, (weights.get(family.key) ?? 0) + 1 / families.length);
  return families.length > 0;
};

/**
 * The genre profile of [songs]: every value of each one's genre tag mapped
 * to its family, a song in n families adding 1/n to each (as Genre mixes
 * count it). Null when none of them has a genre.
 */
export const genreProfile = (songs: readonly GenreTagged[]): GenreProfile | null => {
  const weights = new Map<string, number>();
  let total = 0;
  for (const song of songs) if (weighFamilies(weights, song)) total += 1;
  if (total === 0) return null;
  return new Map([...weights].map(([key, weight]) => [key, weight / total]));
};

/**
 * How alike two profiles are, from 0 (no family in common) to 1 (the same
 * families in the same shares): the cosine of their family shares, so a
 * minor family in common counts for little.
 */
export const genreAffinity = (a: GenreProfile, b: GenreProfile): number => {
  let dot = 0;
  for (const [key, share] of a) dot += share * (b.get(key) ?? 0);
  const length = (profile: GenreProfile) =>
    Math.sqrt([...profile.values()].reduce((sum, share) => sum + share * share, 0));
  const lengths = length(a) * length(b);
  return lengths === 0 ? 0 : Math.min(1, dot / lengths);
};

/** Below this affinity, a known genre receives the faithfulness penalty. */
export const GENRE_AFFINITY_THRESHOLD = 0.5;

/** The Library as genre profiles see it: its artists, and its songs' genre tags and artists. */
export interface GenreProfileLibrary {
  readonly artists: readonly DiscoverSeedArtist[];
  readonly songs: readonly (GenreTagged & Pick<DiscoverLibrarySong, "artistIds">)[];
}

/**
 * An artist's genre profile, by name: a profile, null when the artist has no
 * genre known, undefined when nothing is known of them yet.
 */
export type GenreProfileOf = (artist: string) => GenreProfile | null | undefined;

/** Each Library artist's songs' genre tags, by artist id. */
const songsByArtist = (library: GenreProfileLibrary): Map<number, GenreTagged[]> => {
  const songs = new Map<number, GenreTagged[]>();
  for (const song of library.songs)
    for (const id of song.artistIds) {
      const of = songs.get(id) ?? [];
      of.push(song);
      songs.set(id, of);
    }
  return songs;
};

/**
 * The Library artists' genre profiles (`genreProfile` of the songs that
 * credit them), by name as YouTube Music writes it (as `libraryArtistFinder`
 * finds an artist): null for a Library artist whose songs have no genre,
 * undefined for an artist the Library doesn't have.
 */
export const libraryGenreProfiles = (library: GenreProfileLibrary): GenreProfileOf => {
  const songs = songsByArtist(library);
  const find = libraryArtistFinder(library.artists);
  const profiles = new Map<number, GenreProfile | null>();
  return (name) => {
    const artist = find(name);
    if (artist === null) return undefined;
    if (!profiles.has(artist.id)) profiles.set(artist.id, genreProfile(songs.get(artist.id) ?? []));
    return profiles.get(artist.id) ?? null;
  };
};

/** Whether a radio song's artist suits a mix: alike enough, not alike, or no genre known. */

/**
 * Artists' genre profiles looked up on Deezer, kept on the phone so each is
 * looked up once: by name as artist photos compare it, null for an artist
 * Deezer has no genre for. In the order they were looked up.
 */
export type ArtistProfiles = ReadonlyMap<string, GenreProfile | null>;

/** How many artists' profiles are kept: the latest looked up. */
const PROFILES_KEPT = 2000;

/** [profiles] with those just looked up ([found], by artist name), keeping the latest 2,000. */
export const withArtistProfiles = (
  profiles: ArtistProfiles,
  found: readonly (readonly [artist: string, profile: GenreProfile | null])[],
): ArtistProfiles => {
  const next = new Map(profiles);
  for (const [artist, profile] of found) {
    const key = artistPhotoName(artist);
    next.delete(key);
    next.set(key, profile);
  }
  return new Map([...next].slice(-PROFILES_KEPT));
};

/** An artist's profile as [profiles] know it (`GenreProfileOf`): undefined when never looked up. */
export const artistProfilesKnown =
  (profiles: ArtistProfiles): GenreProfileOf =>
  (artist) =>
    profiles.get(artistPhotoName(artist));

/** What to save for [profiles]. */
export const storedArtistProfiles = (profiles: ArtistProfiles): string =>
  JSON.stringify({
    version: 1,
    artists: [...profiles].map(([key, profile]) => [
      key,
      profile === null ? null : Object.fromEntries(profile),
    ]),
  });

/** The profiles [stored] holds; none when nothing readable is saved. */
export const parseArtistProfiles = (stored: string | null): ArtistProfiles => {
  const { version, artists } = readStoredRecord(stored);
  if (version !== 1 || !Array.isArray(artists)) return new Map();
  return new Map(
    artists.flatMap((entry: unknown): (readonly [string, GenreProfile | null])[] => {
      if (!Array.isArray(entry) || typeof entry[0] !== "string") return [];
      const [key, shares] = entry as [string, unknown];
      if (shares === null) return [[key, null]];
      if (!isRecord(shares)) return [];
      const profile = Object.entries(shares).filter(
        (pair): pair is [string, number] => typeof pair[1] === "number" && Number.isFinite(pair[1]),
      );
      return profile.length === 0 ? [] : [[key, new Map(profile)]];
    }),
  );
};

/** Eager profiles avoid a first lookup doing a whole artist's work inside a candidate step. */
export function* genreProfileSteps(
  songs: Iterable<GenreTagged>,
): Generator<void, GenreProfile | null> {
  const weights = new Map<string, number>();
  let total = 0;
  for (const song of songs) {
    if (weighFamilies(weights, song)) total++;
    yield;
  }
  if (total === 0) return null;
  const result = new Map<string, number>();
  for (const [key, weight] of weights) {
    result.set(key, weight / total);
    yield;
  }
  return result;
}
function* songsByArtistSteps(
  library: GenreProfileLibrary,
): Generator<void, Map<number, GenreTagged[]>> {
  const songs = new Map<number, GenreTagged[]>();
  for (const song of library.songs) {
    for (const id of song.artistIds) {
      const of = songs.get(id) ?? [];
      of.push(song);
      songs.set(id, of);
      yield;
    }
    yield;
  }
  return songs;
}
export function* libraryMixProfilesSteps(
  library: GenreProfileLibrary,
): Generator<void, { profileOf: GenreProfileOf }> {
  const songs = yield* songsByArtistSteps(library);
  const find = yield* libraryArtistFinderSteps(library.artists);
  const profiles = new Map<number, GenreProfile | null>();
  for (const artist of library.artists) {
    const of = songs.get(artist.id) ?? [];
    profiles.set(artist.id, yield* genreProfileSteps(of));
    yield;
  }
  return {
    profileOf: (name) => {
      const artist = find(name);
      return artist === null ? undefined : (profiles.get(artist.id) ?? null);
    },
  };
}
