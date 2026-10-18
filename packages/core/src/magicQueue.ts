/**
 * The Magic Queue (docs/spec.md, Magic Queue): a queue that grows from a seed
 * (a song, playlist, album or artist) out of the Library, a batch at a time,
 * and learns from what the owner skips, favorites, downloads, plays through
 * and edits. This module is the engine: the session, its batches, the
 * signals and the weights they move. The app feeds it the Library's songs
 * and what happens in the queue.
 */

import { mixRecordingOf, type DiscoverRadioSong } from "./discoverMixes.ts";
import type { MixAffinity } from "./genreAffinity.ts";
import type { PlayEndReason } from "./playEvents.ts";
import type { QueueState } from "./queue.ts";
import { pickWeighted, type RandomSource } from "./weightedPick.ts";
import { parseTrackId, ytTrackId } from "./ytMusic.ts";

/** A song as the Magic Queue weighs it. */
export interface MagicSong {
  /** Its queue track id. */
  readonly trackId: string;
  /** Who it's credited to, primary first, by any stable key (the Library's artist ids). */
  readonly artists: readonly string[];
  /** Its genre tag, or null without one. */
  readonly genre: string | null;
}

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
  /** How much each artist (by key) adds to its songs' weight; absent adds nothing. */
  readonly artistAffinity: Readonly<Record<string, number>>;
  /** What each genre (by key) multiplies its songs' weight by; absent is 1. */
  readonly genreAffinity: Readonly<Record<string, number>>;
  /** Artists skipped within the first 30 s: none of their songs comes for the rest of the session. */
  readonly excludedArtists: readonly string[];
  /**
   * The share of each batch YouTube Music's candidates get (the Library's is
   * the rest): 0.5 at the start, always between 0.2 and 0.8.
   */
  readonly ytShare: number;
}

/** The context kind of a Magic Queue's queue; its id is the session's. */
export const MAGIC_QUEUE_CONTEXT = "magic";

/** How many songs follow the first one, then each batch after. */
const FIRST_BATCH = 9;
const BATCH = 10;

/** What the seed's artists add, and its genres multiply, from the start. */
const SEED_ARTIST = 3;
const SEED_GENRE = 3;

/** YouTube Music's share of a batch: where it starts, and how far it can go either way. */
const YT_SHARE_START = 0.5;
const YT_SHARE_MIN = 0.2;
const YT_SHARE_MAX = 0.8;

const clampShare = (share: number): number =>
  Math.min(YT_SHARE_MAX, Math.max(YT_SHARE_MIN, share));

/** A genre tag compared without case or surrounding spaces. */
const genreKey = (genre: string | null): string | null => {
  const key = genre?.trim().toLowerCase() ?? "";
  return key === "" ? null : key;
};

/**
 * Starts a Magic Queue from [seed], whose songs are [seedSongs] (the song
 * itself for a song seed): it plays that song, or a random one of the
 * seed's otherwise. Null when the seed has no songs.
 */
export const startMagicQueue = (
  seed: MagicSeed,
  seedSongs: readonly MagicSong[],
  { id, random }: { readonly id: string; readonly random: RandomSource },
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
      ytShare: YT_SHARE_START,
    },
    first: pick.trackId,
  };
};

/** How heavily [song] weighs in [session]'s next batch. */
const weightOf = (session: MagicSession, song: MagicSong): number => {
  const artists = song.artists.reduce(
    (sum, artist) => sum + (session.artistAffinity[artist] ?? 0),
    0,
  );
  const genre = genreKey(song.genre);
  return (1 + artists) * (genre === null ? 1 : (session.genreAffinity[genre] ?? 1));
};

/**
 * [count] of [songs] picked at random from [random], the heavier more often;
 * a song [session] queued already, or one by an artist it excluded, never.
 */
const pick = (
  session: MagicSession,
  songs: readonly MagicSong[],
  count: number,
  random: RandomSource,
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
    candidates.push({ song: candidate, weight: weightOf(session, candidate) });
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
 * is picked at random from [random], the heavier more often. A song the
 * session queued already never comes back, nor one by an artist it
 * excluded; fewer (or none) when both run dry.
 */
export const magicBatch = (
  session: MagicSession,
  library: readonly MagicSong[],
  random: RandomSource,
  yt: readonly MagicSong[] = [],
): { readonly session: MagicSession; readonly trackIds: readonly string[] } => {
  const size = session.batches === 0 ? FIRST_BATCH : BATCH;
  const fromYt = pick(session, yt, Math.round(size * session.ytShare), random);
  const fromLibrary = pick(session, library, size - fromYt.length, random);
  const taken = new Set(fromYt.map((song) => song.trackId));
  const moreYt = pick(
    session,
    yt.filter((song) => !taken.has(song.trackId)),
    size - fromYt.length - fromLibrary.length,
    random,
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
 * 20–80%.
 */
export const magicSignal = (
  learning: MagicSession,
  { kind, song }: MagicSignal,
): MagicSession => {
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
export const MAGIC_SKIP_MS = 30_000;

/**
 * What a play's end tells a Magic Queue: skipped within its first 30 s is a
 * skip, played to the end is positive; anything else (skipped later,
 * stopped, cut short) says nothing (null).
 */
export const magicPlaySignal = (play: {
  readonly endReason: PlayEndReason;
  readonly listenedMs: number;
}): "skip" | "playedThrough" | null => {
  if (play.endReason === "completed") return "playedThrough";
  return play.endReason === "skipped" && play.listenedMs < MAGIC_SKIP_MS ? "skip" : null;
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

/**
 * The YouTube Music candidates in a seed's [radio], in its order: songs whose
 * artist suits the seed's genres ([affinity], `mixAffinity`: "match" only,
 * so an artist with no genre known stays out). Music videos, songs the
 * Library has ([inLibrary]) and a song the radio plays again are left out.
 * Each weighs by its YouTube Music artists, with no genre tag.
 */
export const magicYtCandidates = <S extends DiscoverRadioSong>(
  radio: readonly S[],
  {
    affinity,
    inLibrary,
  }: {
    readonly affinity: (song: S) => MixAffinity;
    readonly inLibrary: (song: S) => boolean;
  },
): MagicYtCandidate<S>[] => {
  const seen = new Set<string>();
  const candidates: MagicYtCandidate<S>[] = [];
  for (const song of radio) {
    const recording = mixRecordingOf(song);
    if (song.video || seen.has(song.videoId) || seen.has(recording)) continue;
    seen.add(song.videoId);
    seen.add(recording);
    if (inLibrary(song) || affinity(song) !== "match") continue;
    candidates.push({ trackId: ytTrackId(song.videoId), artists: song.artists, genre: null, song });
  }
  return candidates;
};

/** What Up Next says over a Magic Queue: "Magic Queue · from <seed>". */
export const magicQueueLabel = (session: MagicSession): string =>
  `Magic Queue · from ${session.seed.title}`;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isStrings = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === "string");

const isWeights = (value: unknown): value is Record<string, number> =>
  isRecord(value) && Object.values(value).every((weight) => typeof weight === "number");

const SEED_KINDS: ReadonlySet<unknown> = new Set(["track", "album", "artist", "playlist"]);

/** Reads a saved session (`JSON.parse` of one), or null when it isn't a valid one. */
export const parseMagicSession = (value: unknown): MagicSession | null => {
  if (!isRecord(value)) return null;
  const { id, seed, used, batches, artistAffinity, genreAffinity, excludedArtists, ytShare } =
    value;
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
  };
};
