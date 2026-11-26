/** Known genre profiles and their affinity; recommendation ranking treats unknown genre as neutral. */
import { artistPhotoName } from "./artistPhoto.ts";
import type { DiscoverLibrarySong, DiscoverSeedArtist } from "./discoverMixes.ts";
import { songFamilies } from "./genreMixes.ts";
import { isRecord, readStoredRecord } from "./storedJson.ts";
import { finishSteps } from "./buildSteps.ts";
import { libraryArtistFinderSteps } from "./ytArtist.ts";

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

/**
 * The Library artists' genre profiles (`genreProfile` of the songs that
 * credit them), by name as YouTube Music writes it (as `libraryArtistFinder`
 * finds an artist): null for a Library artist whose songs have no genre,
 * undefined for an artist the Library doesn't have.
 */
export const libraryGenreProfiles = (library: GenreProfileLibrary): GenreProfileOf =>
  finishSteps(libraryGenreProfilesSteps(library));

/**
 * `libraryGenreProfiles`, a song or an artist per step, for a background
 * slice (#1448): a Magic Queue batch builds it over the whole Library.
 */
export function* libraryGenreProfilesSteps(
  library: GenreProfileLibrary,
): Generator<void, GenreProfileOf> {
  const songs = yield* songsByArtistSteps(library);
  const find = yield* libraryArtistFinderSteps(library.artists);
  const profiles = new Map<number, GenreProfile | null>();
  return (name) => {
    const artist = find(name);
    if (artist === null) return undefined;
    if (!profiles.has(artist.id)) profiles.set(artist.id, genreProfile(songs.get(artist.id) ?? []));
    return profiles.get(artist.id) ?? null;
  };
}

/** Deezer answers by artist name, in the order they were looked up. */
export type ArtistProfiles = ReadonlyMap<
  string,
  { readonly profile: GenreProfile | null; readonly lookedUpAt: number | null }
>;

const PROFILES_KEPT = 2000;
const DAY_MS = 86_400_000;
const KNOWN_PROFILE_AGE_MS = 180 * DAY_MS;
const UNKNOWN_PROFILE_AGE_MS = 30 * DAY_MS;

/** The latest 2,000 Deezer answers, with their lookup times. */
export const withArtistProfiles = (
  profiles: ArtistProfiles,
  found: readonly (readonly [artist: string, profile: GenreProfile | null, lookedUpAt?: number])[],
): ArtistProfiles => {
  const next = new Map(profiles);
  for (const [artist, profile, lookedUpAt] of found) {
    const key = artistPhotoName(artist);
    next.delete(key);
    next.set(key, { profile, lookedUpAt: lookedUpAt ?? null });
  }
  while (next.size > PROFILES_KEPT) next.delete(next.keys().next().value!);
  return next;
};

/** Known answers can still be read while their refresh runs. */
export const artistProfileDue = (
  profiles: ArtistProfiles,
  artist: string,
  now: number,
): boolean => {
  const answer = profiles.get(artistPhotoName(artist));
  if (answer == null || answer.lookedUpAt === null || now < answer.lookedUpAt) return true;
  const age = answer.profile === null ? UNKNOWN_PROFILE_AGE_MS : KNOWN_PROFILE_AGE_MS;
  return now - answer.lookedUpAt >= age;
};

/** Read a stored profile, optionally limited to records predating genre mix lookups. */
export const artistProfilesKnown =
  (profiles: ArtistProfiles, { legacyOnly = false } = {}): GenreProfileOf =>
  (artist) => {
    const answer = profiles.get(artistPhotoName(artist));
    return legacyOnly && answer?.lookedUpAt !== null ? undefined : answer?.profile;
  };

export const storedArtistProfiles = (profiles: ArtistProfiles): string =>
  JSON.stringify({
    version: 2,
    artists: [...profiles].map(([key, { profile, lookedUpAt }]) => [
      key,
      profile === null ? null : Object.fromEntries(profile),
      lookedUpAt,
    ]),
  });

export const parseArtistProfiles = (stored: string | null): ArtistProfiles => {
  const { version, artists } = readStoredRecord(stored);
  if ((version !== 1 && version !== 2) || !Array.isArray(artists)) return new Map();
  const profiles = new Map<string, { profile: GenreProfile | null; lookedUpAt: number | null }>();
  for (const entry of artists as unknown[]) {
    if (!Array.isArray(entry) || typeof entry[0] !== "string") continue;
    const [key, shares, at] = entry as [string, unknown, unknown];
    const lookedUpAt = typeof at === "number" && Number.isFinite(at) && at >= 0 ? at : null;
    if (shares === null) {
      profiles.set(key, { profile: null, lookedUpAt });
    } else if (isRecord(shares)) {
      const pairs = Object.entries(shares).filter(
        (pair): pair is [string, number] => typeof pair[1] === "number" && Number.isFinite(pair[1]),
      );
      if (pairs.length > 0) profiles.set(key, { profile: new Map(pairs), lookedUpAt });
    }
  }
  return profiles;
};

/** Songs' genres added up, on their way to a profile. */
export interface GenreTally {
  readonly weights: ReadonlyMap<string, number>;
  /** How many of the songs had a genre that counts. */
  readonly total: number;
}

/** [from] with [songs] added, which profiles them as if they had all come together. */
export function* genreTallySteps(
  songs: Iterable<GenreTagged>,
  from?: GenreTally,
): Generator<void, GenreTally> {
  const weights = new Map(from?.weights);
  let total = from?.total ?? 0;
  for (const song of songs) {
    if (weighFamilies(weights, song)) total++;
    yield;
  }
  return { weights, total };
}

/** The profile a [tally] adds up to; null with no genre counted. */
export function* tallyProfileSteps({
  weights,
  total,
}: GenreTally): Generator<void, GenreProfile | null> {
  if (total === 0) return null;
  const result = new Map<string, number>();
  for (const [key, weight] of weights) {
    result.set(key, weight / total);
    yield;
  }
  return result;
}

/** Eager profiles avoid a first lookup doing a whole artist's work inside a candidate step. */
export function* genreProfileSteps(
  songs: Iterable<GenreTagged>,
): Generator<void, GenreProfile | null> {
  return yield* tallyProfileSteps(yield* genreTallySteps(songs));
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
