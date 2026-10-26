/**
 * Whose plays are whose, once streamed plays join the Library's: a streamed
 * song the Library has (the store's `streamedTrack` finds the Library song by
 * video id, then by recording key) counts as that Library song, its plays
 * added to the file's; one the Library hasn't counts on its own, by video id.
 * What every per-song count of counted plays sums by, so they all agree.
 */
import { parseTrackId } from "./ytMusic.ts";

/** Plays summed: how many counted, the time listened and the latest play's start. */
export interface PlaySums {
  readonly countedPlays: number;
  readonly listenedMs: number;
  readonly latestPlayAt: number;
}

/** A Library song's own plays (from its file). */
export interface LibraryPlaySums extends PlaySums {
  readonly id: number;
}

/**
 * The plays of a streamed song ([videoId]), and the Library song they count
 * for ([trackId]), or null while the Library has none.
 */
export interface StreamedPlaySums extends PlaySums {
  readonly videoId: string;
  readonly trackId: number | null;
}

export interface PlaysToMerge {
  readonly library?: readonly LibraryPlaySums[];
  readonly streamed: readonly StreamedPlaySums[];
  /**
   * The Library song each of these video ids is (the store's `streamedTrack`
   * of the video alone): what a queued streamed song counts as when it was
   * never streamed, a downloaded one played from its file.
   */
  readonly libraryVideos?: ReadonlyMap<string, number>;
}

/** Each song's plays, Library and streamed ones summed per song. */
export interface MergedPlays {
  /** Each Library song's: its own plays and the streamed plays that are its, by id. */
  readonly library: ReadonlyMap<number, PlaySums>;
  /** Each streamed song's the Library hasn't, by video id. */
  readonly online: ReadonlyMap<string, PlaySums>;
  /**
   * The plays of the song a queue track id stands for: a Library song's, or
   * a streamed song's, the Library song's when the Library has it; undefined
   * for a song without plays here.
   */
  readonly of: (trackId: string) => PlaySums | undefined;
}

const add = (sum: PlaySums | undefined, plays: PlaySums): PlaySums => ({
  countedPlays: (sum?.countedPlays ?? 0) + plays.countedPlays,
  listenedMs: (sum?.listenedMs ?? 0) + plays.listenedMs,
  latestPlayAt: Math.max(sum?.latestPlayAt ?? 0, plays.latestPlayAt),
});

/** The [library] songs' and [streamed] songs' plays, summed per song. */
export const mergeCountedPlays = ({
  library = [],
  streamed,
  libraryVideos = new Map(),
}: PlaysToMerge): MergedPlays => {
  const songs = new Map<number, PlaySums>();
  const online = new Map<string, PlaySums>();
  const videoTracks = new Map(libraryVideos);
  for (const plays of library) songs.set(plays.id, add(songs.get(plays.id), plays));
  for (const plays of streamed)
    if (plays.trackId === null) online.set(plays.videoId, add(online.get(plays.videoId), plays));
    else {
      songs.set(plays.trackId, add(songs.get(plays.trackId), plays));
      videoTracks.set(plays.videoId, plays.trackId);
    }
  const of = (trackId: string): PlaySums | undefined => {
    const ref = parseTrackId(trackId);
    if (ref === null) return undefined;
    if (ref.kind === "library") return songs.get(ref.id);
    const track = videoTracks.get(ref.videoId);
    return track === undefined ? online.get(ref.videoId) : songs.get(track);
  };
  return { library: songs, online, of };
};
