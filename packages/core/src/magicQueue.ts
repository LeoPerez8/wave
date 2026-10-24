/**
 * The Magic Queue (docs/spec.md, Magic Queue): a queue that grows from a seed
 * (a song, playlist, album or artist) out of the Library and YouTube Music, a batch at a time,
 * and learns from what the owner skips, favorites, downloads, plays through
 * and edits. This module is the engine: the session, its batches, the
 * signals and the weights they move. The app feeds it the Library's songs
 * and what happens in the queue.
 */

import { artistNeighbourhood, type ArtistGraph } from "./artistGraph.ts";
import { artistPhotoName } from "./artistPhoto.ts";
import { DISCOVER_MIX_LEVELS, type DiscoverMixLevel } from "./discoverMixLevels.ts";
import type { DiscoverRadioSong } from "./discoverMixes.ts";
import {
  GENRE_AFFINITY_THRESHOLD,
  genreProfile,
  styleOfArtists,
  type GenreProfile,
  type GenreProfileOf,
  type GenreTagged,
  type StyleOf,
} from "./genreAffinity.ts";
import {
  commonStyle,
  genreStyleFamilies,
  songFamilies,
  songStyle,
  styleAffinity,
  type StyleLevel,
} from "./genreMixes.ts";
import type { PlayEnd } from "./playEvents.ts";
import type { QueueState } from "./queue.ts";
import { isRecord } from "./storedJson.ts";
import { MAGIC_SKIP_MS, genreKey, tasteWeight, type TasteProfile } from "./tasteProfile.ts";
import { pickWeighted, type RandomSource } from "./weightedPick.ts";
import { parseTrackId } from "./ytMusic.ts";

/**
 * An artist as the Magic Queue tells them apart, the same for the Library's
 * songs and YouTube Music's: by name, as artist photos (and the YouTube
 * Music artist finder) compare names (`magicArtistKey`).
 */
export type MagicArtistKey = string & { readonly magicArtist: true };

/** [name]'s key as the Magic Queue tells artists apart. */
export const magicArtistKey = (name: string): MagicArtistKey =>
  artistPhotoName(name) as MagicArtistKey;

/** A song as the Magic Queue weighs it. */
export interface MagicSong {
  /** Its queue track id. */
  readonly trackId: string;
  /** Who it's credited to, primary first. */
  readonly artists: readonly MagicArtistKey[];
  /** Its genre family's key (`genreFamily`), or null without a genre known. */
  readonly genre: string | null;
  /**
   * Its style's key (`songStyle`), or null without one known: a Library song's
   * own tags, a YouTube Music song's first artist's (`styleOfArtists`).
   */
  readonly style: string | null;
}

/** A Library song as `magicLibrarySongs` reads it. */
export interface MagicLibrarySong extends GenreTagged {
  readonly id: number;
  /** Every artist it credits, primary first. */
  readonly artistIds: readonly number[];
}

/**
 * The Library's songs as the Magic Queue weighs them, the Library's
 * [artists] naming each song's: by their artists' names and the family of
 * their genre tag (its first value's, when it has several).
 */
export const magicLibrarySongs = (
  artists: readonly { readonly id: number; readonly name: string }[],
): ((song: MagicLibrarySong) => MagicSong) => {
  const keys = new Map(artists.map((artist) => [artist.id, magicArtistKey(artist.name)]));
  return magicSongMapper(keys);
};

const magicSongMapper =
  (keys: ReadonlyMap<number, MagicArtistKey>) =>
  (song: MagicLibrarySong): MagicSong => ({
    trackId: String(song.id),
    artists: song.artistIds.flatMap((id) => keys.get(id) ?? []),
    genre: songFamilies(song)[0]?.key ?? null,
    style: songStyle(song),
  });

/** Builds the shared Library-to-MagicSong mapper without one unbounded artist pass. */
export function* magicLibraryMapperSteps(
  artists: readonly { readonly id: number; readonly name: string }[],
): Generator<void, (song: MagicLibrarySong) => MagicSong> {
  const keys = new Map<number, MagicArtistKey>();
  for (const artist of artists) {
    keys.set(artist.id, magicArtistKey(artist.name));
    yield;
  }
  return magicSongMapper(keys);
}

/**
 * A Magic Queue needs shared genre mass, not just aligned vectors: a minor
 * Rock share in an acoustic seed mustn't admit a mostly rap/metal artist.
 * At Balanced at least half of the two profiles must overlap. Mixes keep
 * their existing cosine rule. Missing profiles cannot establish a match.
 */
export const magicGenreMatches = (
  seed: GenreProfile | null,
  candidate: GenreProfile | null | undefined,
  threshold: number,
): boolean => {
  if (seed === null || candidate == null || seed.size === 0 || candidate.size === 0) return false;
  let shared = 0;
  for (const [family, share] of seed) shared += Math.min(share, candidate.get(family) ?? 0);
  return shared + 1e-9 >= threshold;
};

/** Whether the known family evidence supports the style beyond a minor tag. */
const styleSupported = (
  profile: GenreProfile | null | undefined,
  style: string | null,
): boolean => {
  // Known styles alone remain evidence when no family profile is available.
  if (profile == null || profile.size === 0) return true;
  if (style === null) return false;
  const families = genreStyleFamilies(style);
  let share = 0;
  for (const [family, weight] of profile) if (families.has(family)) share += weight;
  return share + 1e-9 >= GENRE_AFFINITY_THRESHOLD;
};

/**
 * Strict Magic Queue eligibility, before ranking/learning. Missing styles
 * need both family overlap and closeness; association cannot override known
 * incompatible genres. Known matching styles are direct evidence, including
 * cross-family styles/neighbours. Any known profile must support its style
 * with at least half its mass, so one minor tag cannot override the rest.
 */
export const magicStyleMatches = (
  seed: { readonly profile: GenreProfile | null; readonly style: string | null },
  candidate: { readonly profile: GenreProfile | null | undefined; readonly style: string | null },
  level: StyleLevel,
  close: boolean,
  threshold: number,
): boolean => {
  const affinity = styleAffinity(seed.style, candidate.style, level);
  if (affinity === "miss") return false;
  if (affinity === "unknown")
    return close && magicGenreMatches(seed.profile, candidate.profile, threshold);
  return (
    styleSupported(seed.profile, seed.style) && styleSupported(candidate.profile, candidate.style)
  );
};

/**
 * The Library's songs a Magic Queue's batch may pick from (as
 * `magicLibrarySongs` weighs them): those that pass the genre affinity check
 * against [session]'s seed profile (`magicSeedProfile`) at [threshold] (the
 * Magic Queue section's Genre faithfulness, `magicLibraryThreshold`), as its
 * YouTube Music candidates do. A song's genre is its genre tag's profile;
 * without a tag, its primary artist's ([profileOf]: the Library's, else
 * Deezer's). Strict steps use `magicStyleMatches`: either direct style
 * evidence, supported by known profiles, or family overlap and closeness.
 * Without either proof it stays out. A null [threshold] without [styles]
 * (Wander) admits every song.
 */
export const magicLibraryCandidates = (
  session: MagicSession,
  library: {
    readonly artists: readonly { readonly id: number; readonly name: string }[];
    readonly songs: readonly MagicLibrarySong[];
  },
  {
    profileOf,
    threshold = GENRE_AFFINITY_THRESHOLD,
    styles,
    graph = null,
    seedProfile,
  }: {
    readonly profileOf: GenreProfileOf;
    /**
     * The seed's profile when the batch knows it already (its catalog pick's,
     * which counts its song radio's artists); absent: `magicSeedProfile` of the session.
     */
    readonly seedProfile?: GenreProfile | null;
    readonly threshold?: number | null;
    /** At Same genres or Close the styles and supporting evidence are checked (`magicStyleMatches`); null: families only. */
    readonly styles?: StyleLevel | null;
    /** The artist graph, for the neighbourhood a song of an unknown style may be close by (`magicCloseArtists`). */
    readonly graph?: ArtistGraph | null;
  },
): MagicSong[] => {
  const toMagicSong = magicLibrarySongs(library.artists);
  if (!styles && threshold === null) return library.songs.map(toMagicSong);
  const seed = seedProfile === undefined ? magicSeedProfile(session, profileOf) : seedProfile;
  // Nothing to hold songs to: the seed's own artists and their neighbourhood stand in (association alone).
  const unknownSeed = (seed === null || seed.size === 0) && session.seedStyle === null;
  const close = styles || unknownSeed ? magicCloseArtists(session, graph) : new Set<string>();
  const names = new Map(library.artists.map((artist) => [artist.id, artist.name]));
  const profileOfSong = (song: MagicLibrarySong): GenreProfile | null => {
    const own = genreProfile([song]);
    if (own !== null) return own;
    const primary = song.artistIds[0];
    const name = primary === undefined ? undefined : names.get(primary);
    return name === undefined ? null : (profileOf(name) ?? null);
  };
  return library.songs.flatMap((song) => {
    const profile = profileOfSong(song);
    const candidate = toMagicSong(song);
    const admitted = unknownSeed
      ? candidate.artists.some((artist) => close.has(artist))
      : styles
        ? magicStyleMatches(
            { profile: seed, style: session.seedStyle },
            { profile, style: candidate.style },
            styles,
            candidate.artists.some((artist) => close.has(artist)),
            threshold ?? GENRE_AFFINITY_THRESHOLD,
          )
        : magicGenreMatches(seed, profile, threshold ?? GENRE_AFFINITY_THRESHOLD);
    return admitted ? [candidate] : [];
  });
};

/**
 * The artists a Magic Queue holds its candidates of an unknown style to at
 * Same genres and Close (`magicLibraryCandidates`, `magicCatalogCandidates`):
 * its seed artists (its radio artists) and, with the artist [graph], their
 * neighbourhood in it.
 */
export const magicCloseArtists = (
  session: MagicSession,
  graph: ArtistGraph | null,
): ReadonlySet<string> => {
  const close = new Set<string>(session.radioArtists.map(magicArtistKey));
  if (graph !== null)
    for (const neighbour of artistNeighbourhood(graph, session.radioArtists))
      close.add(neighbour.key);
  return close;
};

/** The family that has the largest share of [profile] (the first on a tie), or null. */
const dominantFamily = (profile: GenreProfile | null | undefined): string | null => {
  let dominant: string | null = null;
  let most = 0;
  for (const [family, share] of profile ?? []) {
    if (share <= most) continue;
    dominant = family;
    most = share;
  }
  return dominant;
};

/**
 * A YouTube Music song as the Magic Queue weighs it: by its artists' names,
 * and the dominant genre family of its first artist with a profile known
 * ([profileOf]: the Library's, else Deezer's); none when no artist's is.
 */
export const magicYtSong = (
  song: { readonly trackId: string; readonly artists: readonly string[] },
  profileOf: GenreProfileOf,
  styleOf?: StyleOf,
): MagicSong => {
  let genre: string | null = null;
  for (const artist of song.artists) {
    genre = dominantFamily(profileOf(artist));
    if (genre !== null) break;
  }
  return {
    trackId: song.trackId,
    artists: song.artists.map(magicArtistKey),
    genre,
    style: styleOfArtists(song.artists, styleOf),
  };
};

/** What a Magic Queue was started from. */
export interface MagicSeed {
  readonly kind: "track" | "album" | "artist" | "playlist";
  readonly id: string;
  /** Its name, as Up Next says it ("Magic Queue · from <title>"). */
  readonly title: string;
}

/** A Magic Queue under way: everything it learned so far. Plain JSON, saved with the queue. */
export interface MagicSession {
  /** Tells this session apart from the others: its queue's context id. */
  readonly id: string;
  readonly seed: MagicSeed;
  /** Every song the session queued, each once: none comes back. */
  readonly used: readonly string[];
  /** How many batches followed the first song so far. */
  readonly batches: number;
  /** How much each artist (by `MagicArtistKey`) adds to its songs' weight; absent adds nothing. */
  readonly artistAffinity: Readonly<Record<string, number>>;
  /** What each genre family (by key) multiplies its songs' weight by; absent is 1. */
  readonly genreAffinity: Readonly<Record<string, number>>;
  /** Artists skipped within the first 30 s: none of their songs comes for the rest of the session. */
  readonly excludedArtists: readonly string[];
  /**
   * The share of each batch YouTube Music's candidates get (the Library's is
   * the rest): its level's (`magicQueueShare`) at the start, always between 0.2 and 1.
   */
  readonly ytShare: number;
  /** The artists whose YouTube Music radios it draws on (`magicRadioArtists`); none without. */
  readonly radioArtists: readonly string[];
  /**
   * The seed songs' genre profile, by family key, which its YouTube Music
   * candidates are held to (`magicSeedProfile`); null when none has a genre.
   */
  readonly seedProfile: Readonly<Record<string, number>> | null;
  /**
   * The seed songs' style (`commonStyle` of theirs), which Same genres and
   * Close hold the candidates to (`styleAffinity`); null when none has one,
   * and then only candidates with family overlap and closeness can join.
   */
  readonly seedStyle: string | null;
  /**
   * The seed songs' YouTube video ids (those downloaded from YouTube): whose
   * own radio a refill reads when its radio artists' bring nothing; none without.
   */
  readonly seedVideoIds: readonly string[];
}

/** What a Magic Queue's YouTube Music radio grows from, as `startMagicQueue` takes it. */
export interface MagicRadioSeed {
  /** Each seed song's primary artist, by name, as YouTube Music is asked for them. */
  readonly artists: readonly string[];
  /** The seed songs' genre profile (`genreProfile`), or null when none has a genre. */
  readonly profile: GenreProfile | null;
  /** The seed songs' YouTube video ids, the song played first's first; none without. */
  readonly videoIds?: readonly string[];
}

/** [artists]' profiles together ([profileOf]), each known one counting alike; null when none is known. */
const averageProfile = (
  artists: Iterable<string>,
  profileOf: GenreProfileOf,
): GenreProfile | null => {
  const weights = new Map<string, number>();
  let known = 0;
  for (const artist of artists) {
    const profile = profileOf(artist);
    if (profile === null || profile === undefined || profile.size === 0) continue;
    known += 1;
    for (const [family, share] of profile) weights.set(family, (weights.get(family) ?? 0) + share);
  }
  if (known === 0) return null;
  return new Map([...weights].map(([family, weight]) => [family, weight / known]));
};

/**
 * The genre profile [session]'s candidates, from both sources, are held to:
 * the seed songs' (`seedProfile`); when none of them has a genre tag, its
 * radio artists' profiles together ([profileOf]: the Library's, else
 * Deezer's), each counting alike; when nothing is known of them either, the
 * profiles of the primary artists of the songs the seed's radios brought
 * ([radio], `magicSeedRadio`: its own song radio when its artists' brought
 * nothing), each artist once. Null means no safe genre match can be
 * established: nothing is known anywhere (or no [profileOf] to ask).
 */
export const magicSeedProfile = (
  session: MagicSession,
  profileOf?: GenreProfileOf,
  radio: readonly { readonly artists: readonly string[] }[] = [],
): GenreProfile | null => {
  if (session.seedProfile !== null) return new Map(Object.entries(session.seedProfile));
  if (profileOf === undefined) return null;
  return (
    averageProfile(session.radioArtists, profileOf) ??
    averageProfile(new Set(radio.flatMap((song) => song.artists.slice(0, 1))), profileOf)
  );
};

/** The context kind of a Magic Queue's queue; its id is the session's. */
export const MAGIC_QUEUE_CONTEXT = "magic";

/** How many songs follow the first one, then each batch after. */
const FIRST_BATCH = 9;
const BATCH = 10;

/** What the seed's artists add, and its genres multiply, from the start. */
const SEED_ARTIST = 3;
const SEED_GENRE = 3;

/** YouTube Music's share of a batch: where it starts without a level, and how far it can go either way. */
const YT_SHARE_START = 0.5;
const YT_SHARE_MIN = 0.2;
const YT_SHARE_MAX = 1;

const clampShare = (share: number): number => Math.min(YT_SHARE_MAX, Math.max(YT_SHARE_MIN, share));

/**
 * The YouTube Music share a Magic Queue starts at for Discover's new-music
 * [level], on the mixes' scale (`DISCOVER_MIX_LEVELS`): from 20% at level 1
 * to 100% at level 5 (All new), 60% at level 3 (the default). Signals then
 * move it within those bounds.
 */
export const magicQueueShare = (level: DiscoverMixLevel): number =>
  (level * YT_SHARE_MAX) / DISCOVER_MIX_LEVELS.length;

/**
 * Starts a Magic Queue from [seed], whose songs are [seedSongs] (the song
 * itself for a song seed): it plays that song, or a random one of the
 * seed's otherwise. Its YouTube Music radio grows from [radio] (none
 * without). YouTube Music's share of a batch starts at [ytShare]
 * (`magicQueueShare`, kept within 20-100%), half without. Null when the seed
 * has no songs.
 */
export const startMagicQueue = (
  seed: MagicSeed,
  seedSongs: readonly MagicSong[],
  {
    id,
    random,
    radio,
    ytShare = YT_SHARE_START,
  }: {
    readonly id: string;
    readonly random: RandomSource;
    readonly radio?: MagicRadioSeed;
    readonly ytShare?: number;
  },
): { readonly session: MagicSession; readonly first: string } | null => {
  const pick =
    seed.kind === "track"
      ? (seedSongs.find((candidate) => candidate.trackId === seed.id) ?? seedSongs[0])
      : seedSongs[Math.floor(random() * seedSongs.length)];
  if (pick === undefined) return null;
  const artistAffinity: Record<string, number> = {};
  const genreAffinity: Record<string, number> = {};
  for (const candidate of seedSongs) {
    for (const artist of candidate.artists) artistAffinity[artist] = SEED_ARTIST;
    const genre = genreKey(candidate.genre);
    if (genre !== null) genreAffinity[genre] = SEED_GENRE;
  }
  return {
    session: {
      id,
      seed,
      used: [pick.trackId],
      batches: 0,
      artistAffinity,
      genreAffinity,
      excludedArtists: [],
      ytShare: clampShare(ytShare),
      radioArtists: radio === undefined ? [] : magicRadioArtists(seed, radio.artists),
      seedProfile:
        radio === undefined || radio.profile === null ? null : Object.fromEntries(radio.profile),
      seedStyle: commonStyle(seedSongs.map((candidate) => candidate.style)),
      seedVideoIds: radio?.videoIds ?? [],
    },
    first: pick.trackId,
  };
};

/**
 * How heavily [song] weighs in [session]'s next batch: by what the session
 * learned, times what the owner's [taste] profile says of it (`tasteWeight`).
 */
const weightOf = (session: MagicSession, song: MagicSong, taste: TasteProfile | null): number => {
  const artists = song.artists.reduce(
    (sum, artist) => sum + (session.artistAffinity[artist] ?? 0),
    0,
  );
  const genre = genreKey(song.genre);
  const learned = (1 + artists) * (genre === null ? 1 : (session.genreAffinity[genre] ?? 1));
  return taste === null ? learned : learned * tasteWeight(taste, song);
};

/**
 * How heavily [song] weighs by what [session] learned alone (its artists'
 * and its genre's weight), as a batch weighs it before the taste profile:
 * 1 for a song the session knows nothing about.
 */
export const magicSessionWeight = (session: MagicSession, song: MagicSong): number =>
  weightOf(session, song, null);

/**
 * [count] of [songs] picked at random from [random], the heavier more often
 * (weighed with [taste]); a song [session] queued already, or one by an
 * artist it excluded, never.
 */
const pick = (
  session: MagicSession,
  songs: readonly MagicSong[],
  count: number,
  random: RandomSource,
  taste: TasteProfile | null,
): MagicSong[] => {
  if (count <= 0) return [];
  const used = new Set(session.used);
  const excluded = new Set(session.excludedArtists);
  const seen = new Set<string>();
  const candidates: { song: MagicSong; weight: number }[] = [];
  for (const candidate of songs) {
    if (used.has(candidate.trackId) || seen.has(candidate.trackId)) continue;
    if (candidate.artists.some((artist) => excluded.has(artist))) continue;
    seen.add(candidate.trackId);
    candidates.push({ song: candidate, weight: weightOf(session, candidate, taste) });
  }
  // Heaviest first, so the luckiest draw lands on the heaviest song.
  // oxlint-disable-next-line unicorn/no-array-sort -- sorts a fresh array; Hermes lacks toSorted
  candidates.sort((a, b) => b.weight - a.weight);
  return pickWeighted(candidates, count, (entry) => entry.weight, random).map(
    (entry) => entry.song,
  );
};

/** [a] and [b] spread evenly through each other, each in its own order. */
const interleave = <T>(a: readonly T[], b: readonly T[]): T[] => {
  const total = a.length + b.length;
  const out: T[] = [];
  let fromA = 0;
  let fromB = 0;
  for (let i = 0; i < total; i += 1) {
    // [b] goes next whenever it's behind its share so far.
    const bDue = Math.floor(((i + 1) * b.length) / total);
    const next = fromB < bDue ? b[fromB++] : a[fromA++];
    if (next !== undefined) out.push(next);
  }
  return out;
};

/**
 * [session]'s next batch: 9 songs after the first one, then 10 at a time,
 * out of [library] and YouTube Music's candidates [yt] (none offline or
 * with the YT Music switch off). YouTube Music gets its share of the batch
 * (`ytShare`) and the Library the rest, either making up for the other
 * running short; the two's songs are spread through each other. Each song
 * is picked at random from [random], the heavier more often: by what the
 * session learned and, from the first batch, by the owner's [taste] profile
 * (`tasteProfile`; none weighs by the session alone). A song the session
 * queued already never comes back, nor one by an artist it excluded; fewer
 * (or none) when both run dry.
 */
export const magicBatch = (
  session: MagicSession,
  library: readonly MagicSong[],
  random: RandomSource,
  yt: readonly MagicSong[] = [],
  taste: TasteProfile | null = null,
): { readonly session: MagicSession; readonly trackIds: readonly string[] } => {
  const size = session.batches === 0 ? FIRST_BATCH : BATCH;
  const fromYt = pick(session, yt, Math.round(size * session.ytShare), random, taste);
  const fromLibrary = pick(session, library, size - fromYt.length, random, taste);
  const taken = new Set(fromYt.map((song) => song.trackId));
  const moreYt = pick(
    session,
    yt.filter((song) => !taken.has(song.trackId)),
    size - fromYt.length - fromLibrary.length,
    random,
    taste,
  );
  const trackIds = interleave(fromLibrary, [...fromYt, ...moreYt]).map((song) => song.trackId);
  return {
    session: { ...session, used: [...session.used, ...trackIds], batches: session.batches + 1 },
    trackIds,
  };
};

/**
 * Something the owner did to a song of the session:
 * - `skip`: tapped Next within its first 30 s (`magicPlaySignal`).
 * - `removed`: took a recommendation out of Up Next; it counts as a skip.
 * - `favorite`, `download`, `playedThrough`: positive, strongest first.
 * - `added`: lined it up with Play Next or Add to Queue; positive.
 */
export type MagicSignalKind =
  "skip" | "removed" | "favorite" | "download" | "playedThrough" | "added";

export interface MagicSignal {
  readonly kind: MagicSignalKind;
  readonly song: MagicSong;
}

/** What each positive signal adds to the song's artists, strongest first. */
const POSITIVE: { readonly [K in MagicSignalKind]?: number } = {
  favorite: 3,
  download: 2,
  playedThrough: 1,
  added: 1,
};

/** What a positive signal's weight adds to its genre's multiplier, per point. */
const GENRE_GAIN = 0.5;

/** What a skip multiplies its genre's multiplier by, and the least it gets to. */
const GENRE_SKIP = 0.5;
const GENRE_FLOOR = 0.05;

/** How a YouTube Music song's signal moves YouTube Music's share of a batch; others leave it. */
const YT_SHARE_MOVE: { readonly [K in MagicSignalKind]?: number } = {
  favorite: 0.1,
  download: 0.05,
  skip: -0.1,
  removed: -0.1,
};

/**
 * [session] having learned [signal]: a skip (or a removed recommendation)
 * excludes the song's primary artist for the rest of the session and lowers
 * its genre's weight, never to nothing, so a one-genre seed doesn't run dry;
 * a positive signal adds to its artists' weight and its genre's, a favorite
 * most, then a download, then a song played to the end or added. Either way
 * the song itself never comes back. A YouTube Music song's favorite or
 * download moves YouTube Music's share of a batch up, its skip down, within
 * 20–100%.
 */
export const magicSignal = (learning: MagicSession, { kind, song }: MagicSignal): MagicSession => {
  const move = parseTrackId(song.trackId)?.kind === "yt" ? (YT_SHARE_MOVE[kind] ?? 0) : 0;
  const session =
    move === 0 ? learning : { ...learning, ytShare: clampShare(learning.ytShare + move) };
  const used = session.used.includes(song.trackId) ? session.used : [...session.used, song.trackId];
  const genre = genreKey(song.genre);
  const genreAffinity = { ...session.genreAffinity };
  if (kind === "skip" || kind === "removed") {
    const [primary] = song.artists;
    const excludedArtists =
      primary === undefined || session.excludedArtists.includes(primary)
        ? session.excludedArtists
        : [...session.excludedArtists, primary];
    if (genre !== null)
      genreAffinity[genre] = Math.max(GENRE_FLOOR, (genreAffinity[genre] ?? 1) * GENRE_SKIP);
    return { ...session, used, excludedArtists, genreAffinity };
  }
  const gain = POSITIVE[kind] ?? 0;
  const artistAffinity = { ...session.artistAffinity };
  for (const artist of song.artists) artistAffinity[artist] = (artistAffinity[artist] ?? 0) + gain;
  if (genre !== null) genreAffinity[genre] = (genreAffinity[genre] ?? 1) + gain * GENRE_GAIN;
  return { ...session, used, artistAffinity, genreAffinity };
};

/** Tapping Next before this much of a song played is a skip; later, it's neutral. */
export { MAGIC_SKIP_MS };

/**
 * What a play's end tells a Magic Queue: Next (moving on to the following
 * entry) within its first 30 s is a skip, played to the end is positive;
 * anything else (Next later, Previous, picking another Up Next entry, a
 * replay, stopped, cut short) says nothing (null).
 */
export const magicPlaySignal = ({
  play,
  byNext,
}: {
  readonly play: Pick<PlayEnd["play"], "endReason" | "listenedMs">;
  readonly byNext: PlayEnd["byNext"];
}): "skip" | "playedThrough" | null => {
  if (play.endReason === "completed") return "playedThrough";
  return play.endReason === "skipped" && byNext && play.listenedMs < MAGIC_SKIP_MS ? "skip" : null;
};

/**
 * Whether [state] is [session]'s queue: started by it (its context) and not
 * replaced since. Playing something else ends the session.
 */
export const isMagicQueue = (session: MagicSession, state: QueueState): boolean =>
  state.context?.kind === MAGIC_QUEUE_CONTEXT && state.context.id === session.id;

/** A recommendation: a context entry of a Magic Queue (songs lined up by hand have none). */
const recommended = (entry: QueueState["entries"][number]): boolean => entry.contextIndex !== null;

/**
 * Whether [session] should add its next batch to [state]: it's still the
 * session's queue and Up Next holds no recommendation, so the batch is
 * picked once the previous one was weighed. Songs lined up by hand don't
 * hold it back.
 */
export const wantsMagicBatch = (session: MagicSession, state: QueueState): boolean =>
  isMagicQueue(session, state) &&
  state.index >= 0 &&
  !state.entries.slice(state.index + 1).some(recommended);

/**
 * Whether Up Next shows [session]'s next batch loading (skeleton rows where
 * it will land): a batch is being picked for it ([picking] is the id of the
 * session one is picked for, null while none is) and [state] still wants it.
 * So the loading goes the moment the batch lands in Up Next, and the moment
 * something else plays, whenever the picking itself ends.
 */
export const magicBatchLoading = (
  session: MagicSession | null,
  picking: MagicSession["id"] | null,
  state: QueueState,
): boolean => session !== null && picking === session.id && wantsMagicBatch(session, state);

/**
 * Whether Up Next shows that [session]'s next batch couldn't be picked (a
 * quiet line with Try Again): its last pick failed ([failed] is the id of
 * the session whose pick failed, null while none has) and [state] still
 * wants the batch. So the line goes once a batch lands, and once something
 * else plays.
 */
export const magicBatchFailed = (
  session: MagicSession | null,
  failed: MagicSession["id"] | null,
  state: QueueState,
): boolean => session !== null && failed === session.id && wantsMagicBatch(session, state);

/**
 * Whether Up Next says that [session]'s last pick found no songs (a quiet
 * line with Try Again, #638): it came back empty ([empty] is the id of the
 * session whose pick did, null while none has) and [state] still wants the
 * batch. So the line goes once a batch lands, and once something else plays.
 */
export const magicBatchEmpty = (
  session: MagicSession | null,
  empty: MagicSession["id"] | null,
  state: QueueState,
): boolean => session !== null && empty === session.id && wantsMagicBatch(session, state);

/**
 * Whether [session] should pick its next batch now: it wants one
 * (`wantsMagicBatch`) and its last pick didn't come back empty ([empty]:
 * the id of the session whose did). After an empty pick, moving through the
 * queue doesn't pick again (the same inputs would find the same nothing);
 * Try Again, a new signal or a slider move clears the mark first.
 */
export const magicPickDue = (
  session: MagicSession,
  empty: MagicSession["id"] | null,
  state: QueueState,
): boolean => empty !== session.id && wantsMagicBatch(session, state);

/** What follows a batch's picking once it ends (`magicPickEnded`). */
export interface MagicPickEnd {
  /** The session a batch is picked for now: still the one that took over, if another did. */
  readonly picking: MagicSession["id"] | null;
  /** Whether to pick again, now for the session under way. */
  readonly again: boolean;
}

/**
 * What follows the picking of a batch for session [ran] once it ends,
 * however it ended, while a batch is picked for [picking] and [session] is
 * under way in [state]: it clears only its own picking, so an older
 * session's pick ending leaves a newer one loading; and when another
 * session took over meanwhile and wants its batch, that one is picked at
 * once rather than at the next queue change. The session it ran for never
 * picks again on its own (a failed or empty pick would go round): the next
 * queue change asks again, after an empty pick only once its mark is
 * cleared (`magicPickDue`).
 */
export const magicPickEnded = (
  ran: MagicSession["id"],
  picking: MagicSession["id"] | null,
  session: MagicSession | null,
  state: QueueState,
): MagicPickEnd => ({
  picking: picking === ran ? null : picking,
  again: session !== null && session.id !== ran && wantsMagicBatch(session, state),
});

/** What the owner did to a Magic Queue between two states of it, by track id. */
export interface MagicQueueEdits {
  /** Songs lined up by hand (Play Next, Add to Queue): positive. */
  readonly added: readonly string[];
  /** Recommendations taken out of Up Next: skips. */
  readonly removed: readonly string[];
}

const NO_EDITS: MagicQueueEdits = { added: [], removed: [] };

/**
 * The edits that took [session]'s queue from [before] to [after]: entries
 * lined up by hand that weren't there (a batch's entries are the session's
 * own), and recommendations in Up Next that are gone. None once either
 * isn't the session's queue (a new play replaced it).
 */
export const magicQueueEdits = (
  session: MagicSession,
  before: QueueState,
  after: QueueState,
): MagicQueueEdits => {
  if (before === after || !isMagicQueue(session, before) || !isMagicQueue(session, after))
    return NO_EDITS;
  const beforeKeys = new Set(before.entries.map((entry) => entry.key));
  const afterKeys = new Set(after.entries.map((entry) => entry.key));
  const added = after.entries
    .filter((entry) => !recommended(entry) && !beforeKeys.has(entry.key))
    .map((entry) => entry.trackId);
  const removed = before.entries
    .slice(before.index + 1)
    .filter((entry) => recommended(entry) && !afterKeys.has(entry.key))
    .map((entry) => entry.trackId);
  return added.length === 0 && removed.length === 0 ? NO_EDITS : { added, removed };
};

/** How many artists' radios a Magic Queue's YouTube Music candidates come from. */
const RADIO_ARTISTS = 2;

/**
 * The artists whose YouTube Music radio a Magic Queue started from [seed]
 * draws on: an artist seed's own; else the most credited of its songs'
 * artists ([seedArtists], one name per song), two at most, the most
 * credited first (the first credited on a tie).
 */
export const magicRadioArtists = (
  seed: MagicSeed,
  seedArtists: readonly string[],
): readonly string[] => {
  if (seed.kind === "artist") return [seed.title];
  const counts = new Map<string, number>();
  for (const artist of seedArtists) counts.set(artist, (counts.get(artist) ?? 0) + 1);
  const ranked = [...counts.entries()];
  // oxlint-disable-next-line unicorn/no-array-sort -- sorts a fresh array; Hermes lacks toSorted
  ranked.sort((a, b) => b[1] - a[1]);
  return ranked.slice(0, RADIO_ARTISTS).map(([artist]) => artist);
};

/** A YouTube Music candidate of a Magic Queue: a song it weighs, with the radio's [song] it is. */
export type MagicYtCandidate<S extends DiscoverRadioSong> = MagicSong & { readonly song: S };

/** What Up Next says over a Magic Queue: "Magic Queue · from <seed>". */
export const magicQueueLabel = (session: MagicSession): string =>
  `Magic Queue · from ${session.seed.title}`;

const isStrings = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === "string");

const isWeights = (value: unknown): value is Record<string, number> =>
  isRecord(value) && Object.values(value).every((weight) => typeof weight === "number");

const SEED_KINDS: ReadonlySet<unknown> = new Set(["track", "album", "artist", "playlist"]);

/**
 * Reads a saved session (`JSON.parse` of one), or null when it isn't a valid
 * one. A session saved before it kept its radio (or with an unreadable one)
 * reads back with none.
 */
export const parseMagicSession = (value: unknown): MagicSession | null => {
  if (!isRecord(value)) return null;
  const {
    id,
    seed,
    used,
    batches,
    artistAffinity,
    genreAffinity,
    excludedArtists,
    ytShare,
    radioArtists,
    seedProfile,
    seedStyle,
    seedVideoIds,
  } = value;
  if (typeof id !== "string" || !isRecord(seed)) return null;
  if (!SEED_KINDS.has(seed["kind"])) return null;
  if (typeof seed["id"] !== "string" || typeof seed["title"] !== "string") return null;
  if (!isStrings(used) || !isStrings(excludedArtists)) return null;
  if (typeof batches !== "number" || !Number.isInteger(batches) || batches < 0) return null;
  if (!isWeights(artistAffinity) || !isWeights(genreAffinity)) return null;
  return {
    id,
    seed: { kind: seed["kind"] as MagicSeed["kind"], id: seed["id"], title: seed["title"] },
    used,
    batches,
    artistAffinity,
    genreAffinity,
    excludedArtists,
    // A session saved before YouTube Music joined starts its share afresh.
    ytShare:
      typeof ytShare === "number" && Number.isFinite(ytShare)
        ? clampShare(ytShare)
        : YT_SHARE_START,
    radioArtists: isStrings(radioArtists) ? radioArtists : [],
    seedProfile: isWeights(seedProfile) ? seedProfile : null,
    // Before styles were saved, family overlap and closeness are both required.
    seedStyle: typeof seedStyle === "string" ? seedStyle : null,
    // Before the seed's video ids were saved, a refill reads only its artists' radios.
    seedVideoIds: isStrings(seedVideoIds) ? seedVideoIds : [],
  };
};
