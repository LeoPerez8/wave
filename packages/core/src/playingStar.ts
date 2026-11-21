import { parseTrackId } from "./ytMusic.ts";

/** What the store answered for the playing song: the Library song it is, and its saved stars. */
export interface PlayingStarAnswer {
  readonly track: { readonly id: number } | null;
  readonly favorite: boolean;
  readonly pendingFavorite: boolean;
}

/** The stars Now Playing's favorite star follows for the song playing. */
export interface PlayingStarSubject {
  /** The Library track whose star it shows, if any. */
  readonly track: number | null;
  /** The video whose pending favorite it shows, if any. */
  readonly video: string | null;
  /** The stars as the store answered them, for when this phone holds none in memory. */
  readonly saved: { readonly favorite: boolean; readonly pendingFavorite: boolean };
}

/**
 * Whose stars Now Playing's favorite star follows for queue track [trackId] (docs/spec.md,
 * story 40). Now Playing reads the song only once it has opened, so on its first frame there
 * is no [answer]: a Library song's queue id is its track, and a YT Music song's its video, so
 * the stars held in memory already say whether it is a favorite. Once read, the answer names
 * the track: the Library song a YT Music song is by now, or none for a song that left.
 */
export const playingStarSubject = (
  trackId: string | null,
  answer: PlayingStarAnswer | undefined,
): PlayingStarSubject => {
  const ref = trackId === null ? null : parseTrackId(trackId);
  const own = ref?.kind === "library" ? ref.id : null;
  return {
    track: answer === undefined ? own : (answer.track?.id ?? null),
    video: ref?.kind === "yt" ? ref.videoId : null,
    saved: {
      favorite: answer?.favorite ?? false,
      pendingFavorite: answer?.pendingFavorite ?? false,
    },
  };
};
