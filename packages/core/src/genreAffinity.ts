/**
 * Genre affinity (docs/spec.md, "Artist mixes", "Genre mixes"): what keeps a
 * mix to its seed's style. An artist's profile is the share of each genre
 * family (Genre mixes' families, `genreFamily`) across their songs, and two
 * profiles' affinity is how alike they are, so sharing one minor genre isn't
 * enough. A radio song joins a mix only when its artist's affinity to the
 * seed's profile reaches [GENRE_AFFINITY_THRESHOLD]; an artist with no genre
 * known only fills a mix up to its fewest songs.
 */

import { artistPhotoName } from "./artistPhoto.ts";
import type { DiscoverLibrarySong, DiscoverMixSeed, DiscoverSeedArtist } from "./discoverMixes.ts";
import { songFamilies } from "./genreMixes.ts";
import { isRecord, readStoredRecord } from "./storedJson.ts";
import { libraryArtistFinder, ytArtistQuery } from "./ytArtist.ts";

/**
 * An artist's genre profile: each genre family's share of their songs (by
 * the family's key), the shares adding up to 1.
 */
export type GenreProfile = ReadonlyMap<string, number>;

/** Something tagged with a genre: a song, or an album on Deezer. */
export type GenreTagged = Pick<DiscoverLibrarySong, "genre" | "genres">;

/**
 * The genre profile of [songs]: every value of each one's genre tag mapped
 * to its family, a song in n families adding 1/n to each (as Genre mixes
 * count it). Null when none of them has a genre.
 */
export const genreProfile = (songs: readonly GenreTagged[]): GenreProfile | null => {
  const weights = new Map<string, number>();
  let total = 0;
  for (const song of songs) {
    const families = songFamilies(song);
    for (const family of families)
      weights.set(family.key, (weights.get(family.key) ?? 0) + 1 / families.length);
    if (families.length > 0) total += 1;
  }
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

/** The affinity a radio song's artist needs to the seed's profile to join its mix. */
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

/**
 * The profile a mix's radio songs are held to: a genre mix's seed artists'
 * Library songs together, an artist mix's artist's profile ([profileOf],
 * Deezer's for an artist outside the Library). Null when it has no genre:
 * the mix then keeps any genre.
 */
export const mixSeedProfile = (
  seed: DiscoverMixSeed,
  library: GenreProfileLibrary,
  profileOf: GenreProfileOf,
): GenreProfile | null => {
  if (seed.kind === "genre" && seed.artists !== undefined) {
    const songs = songsByArtist(library);
    return genreProfile(seed.artists.flatMap((artist) => songs.get(artist.id) ?? []));
  }
  return profileOf(seed.name) ?? null;
};

/** Whether a radio song's artist suits a mix: alike enough, not alike, or no genre known. */
export type MixAffinity = "match" | "miss" | "unknown";

/**
 * Whether a radio song suits the mix whose profile is [seed]: it matches
 * when any of its artists' profile ([profileOf]) reaches
 * [GENRE_AFFINITY_THRESHOLD], misses when its artists with a profile all
 * fall short, and is unknown when none has a genre known. Every song matches
 * a seed with no genre.
 */
export const mixAffinity =
  (
    seed: GenreProfile | null,
    profileOf: GenreProfileOf,
  ): ((song: { readonly artists: readonly string[] }) => MixAffinity) =>
  (song) => {
    if (seed === null) return "match";
    let known = false;
    for (const artist of song.artists) {
      const profile = profileOf(artist);
      if (profile === null || profile === undefined) continue;
      if (genreAffinity(seed, profile) >= GENRE_AFFINITY_THRESHOLD) return "match";
      known = true;
    }
    return known ? "miss" : "unknown";
  };

/**
 * The artists of [songs] to look up on Deezer: those with nothing known of
 * them yet ([profileOf] undefined), each once (by name as artist photos
 * compare it), in the songs' order. Names that aren't an artist's ("Various
 * Artists") are left out.
 */
export const mixProfileLookups = (
  songs: readonly { readonly artists: readonly string[] }[],
  profileOf: GenreProfileOf,
): string[] => {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const song of songs)
    for (const artist of song.artists) {
      const key = artistPhotoName(artist);
      if (seen.has(key)) continue;
      seen.add(key);
      if (ytArtistQuery(artist) !== null && profileOf(artist) === undefined) names.push(artist);
    }
  return names;
};

/** Deezer's albums by the artist [artistId] (the first 50), each with its genre id. */
export const deezerArtistAlbumsUrl = (artistId: number): string =>
  `https://api.deezer.com/artist/${artistId}/albums?limit=50`;

/** Deezer's list of genres, which names the genre ids its albums carry. */
export const DEEZER_GENRES_URL = "https://api.deezer.com/genre";

/** Deezer's genre names by id, from its list of genres; null for an answer that isn't one. */
export const deezerGenreNames = (response: unknown): ReadonlyMap<number, string> | null => {
  if (!isRecord(response) || !Array.isArray(response.data)) return null;
  return new Map(
    response.data.flatMap((genre: unknown) =>
      isRecord(genre) && typeof genre.id === "number" && typeof genre.name === "string"
        ? [[genre.id, genre.name] as const]
        : [],
    ),
  );
};

/**
 * The Deezer id of the artist named [name] in an artist search's answer
 * (`deezerArtistSearchUrl`): the first whose name is it, as artist photos
 * compare names. Null when none is; undefined for an answer that isn't a
 * search's.
 */
export const deezerArtistId = (response: unknown, name: string): number | null | undefined => {
  if (!isRecord(response) || !Array.isArray(response.data)) return undefined;
  const wanted = artistPhotoName(name);
  for (const artist of response.data as unknown[])
    if (
      isRecord(artist) &&
      typeof artist.id === "number" &&
      typeof artist.name === "string" &&
      artistPhotoName(artist.name) === wanted
    )
      return artist.id;
  return null;
};

/**
 * An artist's genre profile from their Deezer albums (`deezerArtistAlbumsUrl`):
 * each album with a genre counts as a song of it ([genres] names the ids,
 * `deezerGenreNames`). Null when no album has a genre; undefined for an
 * answer that isn't a list of albums.
 */
export const deezerArtistProfile = (
  response: unknown,
  genres: ReadonlyMap<number, string>,
): GenreProfile | null | undefined => {
  if (!isRecord(response) || !Array.isArray(response.data)) return undefined;
  return genreProfile(
    (response.data as unknown[]).flatMap((album) => {
      const id = isRecord(album) ? album.genre_id : undefined;
      const genre = typeof id === "number" ? genres.get(id) : undefined;
      return genre === undefined ? [] : [{ genre }];
    }),
  );
};

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
