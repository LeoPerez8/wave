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
 * Every key [song] can be disliked under, the one a new dislike takes first:
 * its queue track ids (`ytTrackId` of its video, the Track id as text).
 */
export const dislikeKeys = ({ id, videoId }: SongIdentity): string[] => [
  ...(videoId === undefined || videoId === null || videoId === "" ? [] : [ytTrackId(videoId)]),
  ...(id === undefined || id === null || id === "" ? [] : [String(id)]),
];

/**
 * The key a new dislike of [song] is kept under: its video when it has one,
 * so the dislike is the same whether the song is streamed, downloaded or
 * deleted from the Library again, here or on another device; else its Track
 * id. Null for a song with neither (an unsearched entry).
 */
export const dislikeKey = (song: SongIdentity): string | null => dislikeKeys(song)[0] ?? null;

/**
 * The disliked songs: every key of each (`dislikedSongs`), so a song is found
 * by whichever key a site has, its Track id or its video.
 */
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

/** [keys], and every other key of the [tracks] they name, until none is added. */
const songKeys = (keys: Iterable<string>, tracks: readonly SongIdentity[]): Set<string> => {
  const all = new Set(keys);
  if (all.size === 0) return all;
  const named = tracks.map(dislikeKeys).filter((own) => own.length > 1);
  for (let grew = true; grew;) {
    grew = false;
    for (const own of named) {
      if (!own.some((key) => all.has(key)) || own.every((key) => all.has(key))) continue;
      for (const key of own) all.add(key);
      grew = true;
    }
  }
  return all;
};

/**
 * The disliked songs, from the keys their dislikes are kept under ([kept])
 * and the Library's songs those may be about ([tracks], each with the video
 * it was downloaded from). A song moves between a Track id and its video (it
 * is downloaded, deleted, or disliked on a device that has it otherwise), so
 * the set holds both keys of each disliked Library song: every site reads it
 * with the one key it knows.
 */
export const dislikedSongs = (
  kept: Iterable<string>,
  tracks: readonly SongIdentity[],
): DislikedSongs => songKeys(kept, tracks);

/**
 * The keys to forget so the songs under [keys] are no longer disliked: those,
 * and every other key the same songs have among [tracks]. Forgetting one a
 * dislike isn't kept under does nothing.
 */
export const dislikesToForget = (
  keys: Iterable<string>,
  tracks: readonly SongIdentity[],
): string[] => [...songKeys(keys, tracks)];

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
