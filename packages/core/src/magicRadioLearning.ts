/** Magic Queue keeps its seed in the lead while learning from liked-song radios. */
import { filterSteps, finishSteps } from "./buildSteps.ts";
import { radioRankingBatchSteps, type RankedRadioSong } from "./radioRanking.ts";
import { magicArtistKey, type MagicSession, type MagicSongRadioSeed } from "./magicQueue.ts";
import type { YtAlbumSong } from "./ytDiscover.ts";
import { recordingMatches, recordingMatchTitle, ytTrackId } from "./ytMusic.ts";

/** Automatic continuations stay with files offline or without YT Music consent. */
export const availableMagicSongs = (
  session: MagicSession,
  songs: readonly RankedRadioSong[],
  where: MagicSongsWhere,
): RankedRadioSong[] => finishSteps(availableMagicSongsSteps(session, songs, where));

/** Where a batch's songs can play from: online, with YT Music on, and the videos kept offline. */
export interface MagicSongsWhere {
  readonly online: boolean;
  readonly ytMusic: boolean;
  readonly cachedVideos: ReadonlySet<string> | null;
}

/** `availableMagicSongs`, a step per song, for a background slice (#1448). */
export const availableMagicSongsSteps = (
  session: MagicSession,
  songs: readonly RankedRadioSong[],
  { online, ytMusic, cachedVideos }: MagicSongsWhere,
): Generator<void, RankedRadioSong[]> =>
  filterSteps(
    songs,
    (song) =>
      song.source === "library" ||
      (ytMusic &&
        (online ||
          (!session.continuation &&
            song.song !== null &&
            cachedVideos?.has(song.song.videoId)))) === true,
  );

/** Keep learned recordings out even when a Library song's video id was unknown before its radio read. */
export const magicRadioExclusions = (
  session: MagicSession,
  songs: Iterable<YtAlbumSong>,
): ReadonlySet<string> => finishSteps(magicRadioExclusionsSteps(session, songs));

/** `magicRadioExclusions`, a step per song, for a background slice (#1448). */
export function* magicRadioExclusionsSteps(
  session: MagicSession,
  songs: Iterable<YtAlbumSong>,
): Generator<void, ReadonlySet<string>> {
  const exclude = new Set<string>();
  for (const id of session.used) {
    exclude.add(id);
    yield;
  }
  for (const id of session.seedVideoIds) exclude.add(ytTrackId(id));
  const recordings = new Map<string, MagicSongRadioSeed[]>();
  for (const radio of session.likedRadios ?? []) {
    if (radio.videoId !== undefined) exclude.add(ytTrackId(radio.videoId));
    const key = recordingMatchTitle(radio.title);
    const bucket = recordings.get(key) ?? [];
    bucket.push(radio);
    recordings.set(key, bucket);
  }
  for (const song of songs) {
    if (
      (recordings.get(recordingMatchTitle(song.title)) ?? []).some((radio) =>
        recordingMatches(
          {
            title: radio.title,
            artist: radio.artists.join(", "),
            durationMs: radio.durationMs ?? 0,
          },
          song,
        ),
      )
    )
      exclude.add(ytTrackId(song.videoId));
    yield;
  }
  return exclude;
}

/**
 * The liked radios' songs a batch may take beside [seed]'s: a recording the
 * original radio brought belongs to its majority, even if a liked radio has it too.
 * A step per candidate.
 */
export function* magicLearnedExtrasSteps<S extends Pick<RankedRadioSong, "trackId" | "song">>(
  seed: readonly S[],
  liked: readonly S[],
): Generator<void, S[]> {
  const ids = new Set<string>();
  const recordings = new Map<string, NonNullable<RankedRadioSong["song"]>[]>();
  for (const candidate of seed) {
    ids.add(candidate.trackId);
    yield;
    const song = candidate.song;
    if (song === null) continue;
    const key = recordingMatchTitle(song.title);
    const bucket = recordings.get(key) ?? [];
    bucket.push(song);
    recordings.set(key, bucket);
  }
  return yield* filterSteps(liked, (candidate) => {
    if (ids.has(candidate.trackId)) return false;
    const song = candidate.song;
    return (
      song === null ||
      !(recordings.get(recordingMatchTitle(song.title)) ?? []).some(
        (other) =>
          other.videoId === song.videoId ||
          recordingMatches(
            {
              title: other.title,
              artist: other.artists.join(", "),
              durationMs: other.durationMs ?? 0,
            },
            song,
          ),
      )
    );
  });
}

/**
 * Whether a batch of [session] may take a song of [candidates]: one it hasn't played or
 * learned from. A step per candidate.
 */
export function* magicRadioEligibleSteps<S extends Pick<RankedRadioSong, "trackId" | "song">>(
  session: MagicSession,
  candidates: Iterable<S>,
): Generator<void, (song: S) => boolean> {
  const songs: YtAlbumSong[] = [];
  for (const candidate of candidates) {
    const song = candidate.song;
    if (song !== null) songs.push(song);
    yield;
  }
  const exclude = yield* magicRadioExclusionsSteps(session, songs);
  return (song) =>
    !exclude.has(song.trackId) &&
    (song.song === null || !exclude.has(ytTrackId(song.song.videoId)));
}

/** About a third from liked radios, filling shortages from the other pool. */
export const magicRadioBatch = (
  seed: readonly RankedRadioSong[],
  liked: readonly RankedRadioSong[],
  options: { readonly size: number; readonly newMusicShare: number },
): RankedRadioSong[] => finishSteps(magicRadioBatchSteps(seed, liked, options));

/** `magicRadioBatch`, a step per candidate. */
function* magicRadioBatchSteps(
  seed: readonly RankedRadioSong[],
  liked: readonly RankedRadioSong[],
  options: { readonly size: number; readonly newMusicShare: number },
): Generator<void, RankedRadioSong[]> {
  const extra = yield* magicLearnedExtrasSteps(seed, liked);
  const learned = yield* radioRankingBatchSteps(extra, {
    ...options,
    size: Math.max(Math.round(options.size / 3), options.size - seed.length),
  });
  const remaining = options.size - learned.length;
  const streams = Math.round(options.size * Math.max(0, Math.min(1, options.newMusicShare)));
  const original = yield* radioRankingBatchSteps(seed, {
    size: remaining,
    newMusicShare:
      remaining === 0
        ? 0
        : (streams - learned.filter((song) => song.source === "stream").length) / remaining,
  });
  if (original.length === 0) return learned;
  const result: RankedRadioSong[] = [];
  let at = 0;
  for (const [index, song] of original.entries()) {
    result.push(song);
    const due = Math.floor(((index + 1) * learned.length) / original.length);
    while (at < due) result.push(learned[at++]!);
  }
  return result;
}

/** A seed song plays ahead of a session's first batch, except a continued queue's and DJ's. */
const batchSize = (session: MagicSession): number =>
  session.batches === 0 && !session.continuation && session.seed.kind !== "dj"
    ? 9
    : session.seed.kind === "dj" && session.batches === 0 && session.used.length > 0
      ? 9
      : 10;

/** Whether each radio pool needs continuations to fill its batch and New music share. */
export const magicRadioReadPlan = (
  session: MagicSession,
  seed: readonly RankedRadioSong[],
  liked: readonly RankedRadioSong[],
  hasLikedRadios: boolean,
): {
  readonly size: number;
  readonly likedQuota: number;
  readonly seedLow: boolean;
  readonly likedLow: boolean;
} => {
  const size = batchSize(session);
  const likedQuota = hasLikedRadios ? Math.round(size / 3) : 0;
  const low = (ranked: readonly RankedRadioSong[], target: number) =>
    ranked.length < target ||
    ranked.filter((song) => song.source === "stream").length < Math.round(target * session.ytShare);
  return {
    size,
    likedQuota,
    seedLow: low(seed, size - Math.min(likedQuota, liked.length)),
    likedLow: hasLikedRadios && low(liked, Math.max(likedQuota, size - seed.length)),
  };
};

/**
 * Selects and commits a ranked batch against the latest session, including
 * recording aliases. A short batch fills its missing places from [fallback]'s
 * ranking, which is only asked for then (ranking is the slow part). The
 * chosen songs come back in order with their track ids.
 */
export const completeMagicRadioBatch = (
  session: MagicSession,
  seed: readonly RankedRadioSong[],
  liked: readonly RankedRadioSong[],
  fallback?: () => MagicRadioFallback,
): CompletedMagicRadioBatch =>
  finishSteps(completeMagicRadioBatchSteps(session, seed, liked, fallback));

/** The rankings a short faithful batch fills its missing places from. */
export interface MagicRadioFallback {
  readonly seed: readonly RankedRadioSong[];
  readonly liked: readonly RankedRadioSong[];
}

/** A completed batch: the session that took it, and its songs in order with their track ids. */
export interface CompletedMagicRadioBatch {
  readonly session: MagicSession;
  readonly trackIds: readonly string[];
  readonly songs: readonly RankedRadioSong[];
}

/**
 * `completeMagicRadioBatch`, a few candidates per step, for a background
 * slice (#1448): a batch weighs the whole playable Library.
 */
export function* completeMagicRadioBatchSteps(
  session: MagicSession,
  seed: readonly RankedRadioSong[],
  liked: readonly RankedRadioSong[],
  fallback?: () => MagicRadioFallback,
): Generator<void, CompletedMagicRadioBatch> {
  const eligible = yield* magicRadioEligibleSteps(session, both(seed, liked));
  const eligibleSeed = yield* filterSteps(seed, eligible);
  const eligibleLiked = yield* filterSteps(liked, eligible);
  let primary = yield* magicRadioBatchSteps(eligibleSeed, eligibleLiked, {
    size: batchSize(session),
    newMusicShare: session.ytShare,
  });
  if (
    session.seed.kind === "dj" &&
    session.batches === 0 &&
    (session.djArtistSeeds?.length ?? 0) > 1
  ) {
    const startedArtists = new Set(session.djStartedArtists ?? []);
    const selectedArtists = (session.djArtistSeeds ?? []).filter(
      (name) => !startedArtists.has(magicArtistKey(name)),
    );
    const byArtist = new Map<string, RankedRadioSong[]>();
    for (const song of both(eligibleSeed, eligibleLiked)) {
      for (const artist of song.artists) {
        if (!selectedArtists.some((name) => magicArtistKey(name) === artist)) continue;
        const songs = byArtist.get(artist) ?? [];
        if (!songs.some((candidate) => candidate.trackId === song.trackId)) songs.push(song);
        byArtist.set(artist, songs);
      }
      yield;
    }
    const chosen: RankedRadioSong[] = [];
    const limit = batchSize(session);
    for (const name of selectedArtists) {
      if (chosen.length >= limit) break;
      const key = magicArtistKey(name);
      const song = byArtist
        .get(key)
        ?.find((candidate) => !chosen.some((item) => item.trackId === candidate.trackId));
      if (song !== undefined) {
        chosen.push(song);
      }
    }
    const remaining = primary;
    while (chosen.length < limit) {
      const lastArtists = new Set(chosen.at(-1)?.artists ?? []);
      const at = remaining.findIndex(
        (song) =>
          !chosen.some((item) => item.trackId === song.trackId) &&
          !song.artists.some((artist) => lastArtists.has(artist)),
      );
      const fallbackAt =
        at < 0
          ? remaining.findIndex((song) => !chosen.some((item) => item.trackId === song.trackId))
          : at;
      if (fallbackAt < 0) break;
      chosen.push(remaining[fallbackAt]!);
    }
    primary = chosen;
  }
  const primaryIds = new Set(primary.map((song) => song.trackId));
  const remaining = batchSize(session) - primary.length;
  const isNewRecording = (song: RankedRadioSong): boolean =>
    !primary.some((chosen) => {
      if (chosen.trackId === song.trackId) return true;
      if (chosen.song === null || song.song === null) return false;
      return (
        chosen.song.videoId === song.song.videoId ||
        recordingMatches(
          {
            title: chosen.song.title,
            artist: chosen.song.artists.join(", "),
            durationMs: chosen.song.durationMs ?? 0,
          },
          song.song,
        )
      );
    });
  const fills = remaining > 0 ? fallback?.() : undefined;
  const isFill = (song: RankedRadioSong) =>
    eligible(song) && !primaryIds.has(song.trackId) && isNewRecording(song);
  const fill =
    fills === undefined
      ? []
      : yield* magicRadioBatchSteps(
          yield* filterSteps(fills.seed, isFill),
          yield* filterSteps(fills.liked, isFill),
          { size: remaining, newMusicShare: session.ytShare },
        );
  const selected = [...primary, ...fill];
  const trackIds = selected.map((song) => song.trackId);
  if (trackIds.length === 0) return { session, trackIds, songs: selected };
  const used = new Set<string>();
  for (const id of session.used) {
    used.add(id);
    yield;
  }
  for (const song of selected) {
    used.add(song.trackId);
    if (song.song !== null) used.add(ytTrackId(song.song.videoId));
  }
  return {
    trackIds,
    songs: selected,
    session: { ...session, used: [...used], batches: session.batches + 1 },
  };
}

/** [first]'s values, then [second]'s, without copying either. */
function* both<A>(first: readonly A[], second: readonly A[]): Generator<A> {
  yield* first;
  yield* second;
}
