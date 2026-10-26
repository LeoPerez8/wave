/**
 * Home's Most played: songs by counted plays over all time, Library and
 * streamed ones together. A streamed song the Library has (a download of it,
 * or the same recording) counts as that Library song, its plays added to the
 * file's.
 */
import { compareTrackRefs } from "./refOrder.ts";
import type { TrackRef } from "./ytMusic.ts";

/** A song's counted plays as the store keeps them over all time. */
export interface KeptPlays {
  readonly countedPlays: number;
  /** When its latest counted play started; null without one. */
  readonly lastCountedAt: number | null;
}

/** A Library song's own plays (from its file). */
export interface LibraryKeptPlays extends KeptPlays {
  readonly id: number;
}

/**
 * The plays of a streamed song ([videoId]), and the Library song they count
 * for ([trackId]), or null while the Library has none.
 */
export interface StreamedKeptPlays extends KeptPlays {
  readonly videoId: string;
  readonly trackId: number | null;
}

/** A Most played song with the plays it is ranked by. */
export interface MostPlayed {
  readonly song: TrackRef;
  readonly countedPlays: number;
  readonly lastCountedAt: number | null;
}

const add = (sum: MostPlayed | undefined, song: TrackRef, plays: KeptPlays): MostPlayed => ({
  song,
  countedPlays: (sum?.countedPlays ?? 0) + plays.countedPlays,
  lastCountedAt:
    sum?.lastCountedAt == null
      ? plays.lastCountedAt
      : plays.lastCountedAt === null
        ? sum.lastCountedAt
        : Math.max(sum.lastCountedAt, plays.lastCountedAt),
});

/**
 * The [limit] songs with the most counted plays, then the latest counted
 * play, of the [library] songs' and [streamed] songs' plays summed per song.
 * Songs without a counted play are left out. For the right top [limit],
 * [library] must hold at least the top [limit] by their own plays and every
 * song a streamed one counts for.
 */
export const rankMostPlayed = (
  library: readonly LibraryKeptPlays[],
  streamed: readonly StreamedKeptPlays[],
  limit: number,
): MostPlayed[] => {
  const songs = new Map<string, MostPlayed>();
  const sum = (key: string, song: TrackRef, plays: KeptPlays) =>
    songs.set(key, add(songs.get(key), song, plays));
  for (const plays of library) sum(String(plays.id), { kind: "library", id: plays.id }, plays);
  for (const plays of streamed) {
    if (plays.trackId === null)
      sum(`yt:${plays.videoId}`, { kind: "yt", videoId: plays.videoId }, plays);
    else sum(String(plays.trackId), { kind: "library", id: plays.trackId }, plays);
  }
  return (
    [...songs.values()]
      .filter((song) => song.countedPlays > 0)
      // oxlint-disable-next-line unicorn/no-array-sort -- sorts a fresh copy; Hermes lacks toSorted
      .sort(
        (a, b) =>
          b.countedPlays - a.countedPlays ||
          (b.lastCountedAt ?? 0) - (a.lastCountedAt ?? 0) ||
          // Library songs first, the latest added first; streamed songs by video id.
          compareTrackRefs(a.song, b.song, "latest first"),
      )
      .slice(0, limit)
  );
};
