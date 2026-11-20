/**
 * Dislike: a mark on a song that keeps it out of what Wave picks on its own
 * (the Magic Queue, the mixes, Discover). It still plays when the owner picks
 * it. Dislike and Favorite exclude each other, and a dislike can be undone
 * with what it replaced. Decided here; the app keeps the dislikes and writes
 * the changes.
 */

import { catalogueOf, type AppLanguage } from "./localisation.ts";
import { ytTrackId } from "./ytMusic.ts";

/**
 * What tells a song apart, as favorites do: a Library song by its Track id, a
 * YT Music song by its video. A song can have both (a radio song the Library
 * has a file of).
 */
export interface SongIdentity {
  /** Its Library Track id. */
  readonly id?: number | string | null | undefined;
  /** Its YouTube Music video. */
  readonly videoId?: string | null | undefined;
}

/**
 * The keys a dislike of [song] can be kept under, the Library's first: its
 * queue track ids (the Track id as text, `ytTrackId` of its video).
 */
export const dislikeKeys = ({ id, videoId }: SongIdentity): string[] => [
  ...(id === undefined || id === null || id === "" ? [] : [String(id)]),
  ...(videoId === undefined || videoId === null || videoId === "" ? [] : [ytTrackId(videoId)]),
];

/**
 * The key [song]'s dislike is kept under: the Library's song when it is one,
 * else the YT Music video. Null for a song with neither (an unsearched entry).
 */
export const dislikeKey = (song: SongIdentity): string | null => dislikeKeys(song)[0] ?? null;

/** The disliked songs, by `dislikeKey`. */
export type DislikedSongs = ReadonlySet<string>;

/** No dislikes: before they're read, or where there are none. */
export const NO_DISLIKES: DislikedSongs = new Set<string>();

/** A dislike as the app keeps it: the song as it was listed when disliked, and when. */
export interface DislikedSong {
  /** Its `dislikeKey`. */
  readonly key: string;
  readonly title: string;
  /** Who it's credited to, primary first. */
  readonly artists: readonly string[];
  readonly durationMs: number | null;
  /** When it was disliked, in ms. */
  readonly dislikedAt: number;
}

/** Whether [song] is disliked, under any key it has. */
export const isDisliked = (disliked: DislikedSongs, song: SongIdentity): boolean =>
  disliked.size > 0 && dislikeKeys(song).some((key) => disliked.has(key));

/**
 * [songs] less the disliked ones, in order: the one filter every pool Wave
 * picks from on its own goes through (the Magic Queue's candidates and seeds,
 * the mixes' songs). A list the owner chose to play is never passed here.
 */
export const withoutDisliked = <S>(
  songs: readonly S[],
  disliked: DislikedSongs,
  identity: (song: S) => SongIdentity,
): S[] =>
  disliked.size === 0 ? [...songs] : songs.filter((song) => !isDisliked(disliked, identity(song)));

/** A song's two marks. They exclude each other. */
export interface SongMarks {
  readonly favorite: boolean;
  readonly disliked: boolean;
}

/** A song with its marks as they are before a change. */
export interface MarkedSong<S> extends SongMarks {
  readonly song: S;
}

/** The writes a change of marks comes to; a song is in at most one list of each mark. */
export interface MarkChanges<S> {
  readonly favorite: readonly S[];
  readonly unfavorite: readonly S[];
  readonly dislike: readonly S[];
  readonly removeDislike: readonly S[];
}

/** A change of marks, and the one that puts back what was there before. */
export interface MarkChange<S> {
  readonly changes: MarkChanges<S>;
  readonly undo: MarkChanges<S>;
}

/** Whether [changes] writes nothing. */
export const noMarkChanges = <S>(changes: MarkChanges<S>): boolean =>
  changes.favorite.length +
    changes.unfavorite.length +
    changes.dislike.length +
    changes.removeDislike.length ===
  0;

/** The writes that take each song from [from] to [to]. */
const writes = <S>(
  songs: readonly MarkedSong<S>[],
  from: (song: MarkedSong<S>) => SongMarks,
  to: (song: MarkedSong<S>) => SongMarks,
): MarkChanges<S> => {
  const pick = (changed: (before: SongMarks, after: SongMarks) => boolean): S[] =>
    songs.flatMap((song) => (changed(from(song), to(song)) ? [song.song] : []));
  return {
    favorite: pick((before, after) => !before.favorite && after.favorite),
    unfavorite: pick((before, after) => before.favorite && !after.favorite),
    dislike: pick((before, after) => !before.disliked && after.disliked),
    removeDislike: pick((before, after) => before.disliked && !after.disliked),
  };
};

const marked = <S>(
  songs: readonly MarkedSong<S>[],
  after: (song: SongMarks) => SongMarks,
): MarkChange<S> => ({
  changes: writes(songs, (song) => song, after),
  undo: writes(songs, after, (song) => song),
});

/**
 * Dislikes [songs] ([on]) or removes their dislikes: a disliked song is no
 * favorite, so disliking a favorite unstars it. Removing a dislike leaves the
 * star as it is. [undo] restores what each song had, the favorite included.
 */
export const dislikeSongs = <S>(songs: readonly MarkedSong<S>[], on: boolean): MarkChange<S> =>
  marked(songs, (song) =>
    on ? { favorite: false, disliked: true } : { ...song, disliked: false },
  );

/**
 * Stars [songs] ([on]) or unstars them: a favorite isn't disliked, so starring
 * a disliked song removes its dislike. Unstarring leaves the dislike as it is.
 */
export const favoriteSongs = <S>(songs: readonly MarkedSong<S>[], on: boolean): MarkChange<S> =>
  marked(songs, (song) =>
    on ? { favorite: true, disliked: false } : { ...song, favorite: false },
  );

/**
 * The confirmation for disliking [count] songs in [language], which the app
 * shows with Undo. Removing a dislike has none, as unstarring has none.
 */
export const dislikeToast = (
  on: boolean,
  count: number,
  language: AppLanguage = "en",
): string | null => {
  if (!on || count < 1) return null;
  const text = catalogueOf(language).itemActions;
  return count === 1 ? text.dislikedSong : text.dislikedSongsCount(count);
};
