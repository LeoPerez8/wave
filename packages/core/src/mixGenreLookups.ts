/**
 * Which radio artists' genres to look up on Deezer next (docs/spec.md,
 * genre affinity): only those that decide a song the mix (or the Magic
 * Queue) would keep next, in the radio's order, and none once enough songs
 * match. The app looks them up, then asks again, till nothing is left to ask.
 */

import { artistPhotoName } from "./artistPhoto.ts";
import {
  MIX_FEWEST,
  MIX_MOST,
  mixRecordingOf,
  type DiscoverMixFilter,
  type DiscoverRadioSong,
} from "./discoverMixes.ts";
import { GENRE_AFFINITY_THRESHOLD, type GenreProfileOf } from "./genreAffinity.ts";
import { songFamilies } from "./genreMixes.ts";
import {
  magicArtistKey,
  magicGenreMatches,
  magicSeedProfile,
  type MagicLibrarySong,
  type MagicSession,
} from "./magicQueue.ts";
import { ytTrackId } from "./ytMusic.ts";
import { ytArtistQuery } from "./ytArtist.ts";

/** What a walk over a radio's songs asks: the names to look up, and how many songs matched. */
interface Asking {
  readonly names: string[];
  readonly matched: number;
}

/**
 * The names [songs] (each a song the mix would keep, genre aside) ask for:
 * walking them in order, a song that matches counts, and one no artist of
 * which matches yet, with an artist never looked up nor [before] asked,
 * asks for those artists; until matched and asking songs add up to [enough].
 */
const ask = <S extends DiscoverRadioSong>(
  songs: readonly S[],
  {
    affinity,
    profileOf,
    before,
    enough,
  }: {
    readonly affinity: DiscoverMixFilter<S>["affinity"];
    readonly profileOf: GenreProfileOf;
    readonly before: ReadonlySet<string>;
    readonly enough: number;
  },
): Asking => {
  const names: string[] = [];
  const asking = new Set<string>();
  let matched = 0;
  let pending = 0;
  for (const song of songs) {
    if (matched + pending >= enough) break;
    if ((affinity?.(song) ?? "match") === "match") {
      matched += 1;
      continue;
    }
    // Names that aren't an artist's ("Various Artists") are never looked up.
    const unseen = song.artists.filter(
      (artist) =>
        ytArtistQuery(artist) !== null &&
        profileOf(artist) === undefined &&
        !before.has(artistPhotoName(artist)),
    );
    if (unseen.length === 0) continue;
    pending += 1;
    for (const artist of unseen) {
      const key = artistPhotoName(artist);
      if (asking.has(key)) continue;
      asking.add(key);
      names.push(artist);
    }
  }
  return { names, matched };
};

/**
 * The artists of [radio] to look up next for a mix that leaves out what
 * [filter] does (`discoverMixSongs`): walking the radio in order, the songs
 * the mix would keep whose genre isn't decided yet (no artist matches, and
 * one was never looked up: [profileOf] undefined) ask for their artists never
 * looked up, until the songs that match and those asking add up to [enough]
 * (the mix's most songs, 50, so mixes stay as long). The songs a refresh
 * avoids ask only when the others leave the mix short of its ten songs.
 * Empty once [enough] songs match, or nothing is left to ask. Artists
 * [asked] already (a lookup that failed, or none made with the Lyrics and
 * genre switch off) aren't asked again.
 */
export const mixProfileLookupsNext = <S extends DiscoverRadioSong>(
  radio: readonly S[],
  {
    filter,
    profileOf,
    asked = [],
    enough = MIX_MOST,
  }: {
    readonly filter: DiscoverMixFilter<S>;
    readonly profileOf: GenreProfileOf;
    /** The names asked for already, as this gave them. */
    readonly asked?: readonly string[];
    readonly enough?: number;
  },
): string[] => {
  const fresh: S[] = [];
  const avoided: S[] = [];
  const videos = new Set(filter.taken);
  const recordings = new Set<string>();
  for (const song of radio) {
    // What `discoverMixSongs` leaves out whatever the genre.
    const recording = mixRecordingOf(song);
    if (song.video || videos.has(song.videoId) || recordings.has(recording)) continue;
    if (filter.known(song)) continue;
    videos.add(song.videoId);
    recordings.add(recording);
    (filter.avoid?.has(song.videoId) === true ? avoided : fresh).push(song);
  }
  const walk = {
    affinity: filter.affinity,
    profileOf,
    before: new Set(asked.map(artistPhotoName)),
  };
  const first = ask(fresh, { ...walk, enough });
  if (first.names.length > 0 || first.matched >= MIX_FEWEST) return first.names;
  return ask(avoided, { ...walk, enough: MIX_FEWEST - first.matched }).names;
};

/**
 * How many YouTube Music candidates a Magic Queue batch wants to pick from:
 * two batches' worth, so even a batch YouTube Music fills alone has a choice.
 */
const MAGIC_CANDIDATES_WANTED = 20;

/** How many of its radio's artists a seed with no genre known looks up a round (`magicRadioLookups`). */
const MAGIC_RADIO_SEED_LOOKUPS = 10;

/** Whether [name] is an artist's, worth a lookup ("Various Artists" isn't). */
const anArtist = (name: string): boolean => ytArtistQuery(name) !== null;

/**
 * The artists whose genres [session]'s seed profile waits for
 * (`magicSeedProfile`): when none of the seed songs has a genre tag, its
 * radio artists with nothing known of them yet ([profileOf] undefined).
 * None for a seed whose songs have one.
 */
export const magicSeedLookups = (session: MagicSession, profileOf: GenreProfileOf): string[] =>
  session.seedProfile !== null
    ? []
    : session.radioArtists.filter((name) => anArtist(name) && profileOf(name) === undefined);

/** How many Library artists a batch looks up at most (`magicLibraryLookups`). */
const MAGIC_LIBRARY_LOOKUPS = 10;

/**
 * The Library artists to look up for [session]'s next batches
 * (`magicLibraryCandidates` leaves out a song with no genre known): the
 * primary artists, with nothing known of them yet ([profileOf] undefined),
 * of the Library's songs without a genre tag, those with the most such
 * songs first, [most] (10) at most. None while the seed has no genre known:
 * its own profile must be resolved first.
 */
export const magicLibraryLookups = (
  session: MagicSession,
  library: {
    readonly artists: readonly { readonly id: number; readonly name: string }[];
    readonly songs: readonly MagicLibrarySong[];
  },
  {
    profileOf,
    most = MAGIC_LIBRARY_LOOKUPS,
  }: { readonly profileOf: GenreProfileOf; readonly most?: number },
): string[] => {
  if (magicSeedProfile(session, profileOf) === null) return [];
  const names = new Map(library.artists.map((artist) => [artist.id, artist.name]));
  const untagged = new Map<string, number>();
  for (const song of library.songs) {
    if (songFamilies(song).length > 0) continue;
    const primary = song.artistIds[0];
    const name = primary === undefined ? undefined : names.get(primary);
    if (name === undefined) continue;
    untagged.set(name, (untagged.get(name) ?? 0) + 1);
  }
  const unknown = [...untagged].filter(([name]) => anArtist(name) && profileOf(name) === undefined);
  // Stable: artists with as many songs keep the Library's order.
  // oxlint-disable-next-line unicorn/no-array-sort -- sorts a fresh array; Hermes lacks toSorted
  unknown.sort((a, b) => b[1] - a[1]);
  return unknown.slice(0, Math.max(0, most)).map(([name]) => name);
};

/**
 * The artists of [session]'s [radio] to look up next (a Magic Queue's
 * catalog candidates, `magicCatalogCandidates`, keep only the songs whose
 * artist matches): first its seed's radio artists when its songs have no
 * genre tag and nothing is known of them (`magicSeedLookups`); then as a
 * mix asks (`mixProfileLookupsNext`), against the seed's profile,
 * until 20 candidates match, leaving out the songs the Library has
 * ([inLibrary]). Artists further down the radio wait for a later batch.
 */
export const magicRadioLookups = <S extends DiscoverRadioSong>(
  session: MagicSession,
  radio: readonly S[],
  {
    profileOf,
    inLibrary,
    asked = [],
    threshold = GENRE_AFFINITY_THRESHOLD,
  }: {
    readonly profileOf: GenreProfileOf;
    readonly inLibrary: (song: S) => boolean;
    readonly asked?: readonly string[];
    readonly threshold?: number;
  },
): string[] => {
  const seed = magicSeedLookups(session, profileOf).filter((name) => !asked.includes(name));
  if (seed.length > 0) return seed;
  const profile = magicSeedProfile(session, profileOf, radio);
  // Its genre then comes from its radio's primary artists (`magicSeedProfile`): those not looked up yet.
  if (profile === null || profile.size === 0)
    return [
      ...new Set(
        radio.flatMap((song) =>
          song.artists
            .slice(0, 1)
            .filter((name) => anArtist(name) && profileOf(name) === undefined && !asked.includes(name)),
        ),
      ),
    ].slice(0, MAGIC_RADIO_SEED_LOOKUPS);
  const used = new Set(session.used);
  const excluded = new Set(session.excludedArtists);
  // Songs no batch picks: the Library's, those queued already and those by excluded artists.
  const known = (song: S) =>
    inLibrary(song) ||
    used.has(ytTrackId(song.videoId)) ||
    song.artists.some((artist) => excluded.has(magicArtistKey(artist)));
  return mixProfileLookupsNext(radio, {
    filter: {
      known,
      taken: new Set(),
      affinity: (song) =>
        song.artists.some((artist) => magicGenreMatches(profile, profileOf(artist), threshold))
          ? "match"
          : "unknown",
    },
    profileOf,
    asked,
    enough: MAGIC_CANDIDATES_WANTED,
  });
};
