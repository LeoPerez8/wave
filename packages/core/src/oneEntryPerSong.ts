/**
 * One entry per song (docs/spec.md, "Collaborative playlists", Conflicts):
 * of two entries of one song in a playlist, the one added first stays and a
 * device that receives the other removes it, without the Graveyard. Only the
 * entries' own fields are compared, never a device's Library, so every device
 * removes the same entry.
 */

import { readPlaylistEntrySong } from "./playlistEntries.ts";
import { joinArtists, recordingMatchTitle, recordingMatches } from "./ytMusic.ts";

/** What an entry says of its song, as the rule compares it. */
export interface EntrySong {
  /** A Library song's recording key. */
  readonly recordingKey: string | null;
  /** The YouTube video id, when the entry has one. */
  readonly videoId: string | null;
  readonly title: string | null;
  readonly artists: readonly string[];
  /** The length in ms; null when unknown. */
  readonly durationMs: number | null;
}

const NO_SONG: EntrySong = {
  recordingKey: null,
  videoId: null,
  title: null,
  artists: [],
  durationMs: null,
};

/**
 * What a synced entry says of its song: a Library song's recording key
 * ([songId]), or the stored song ([ytSong], `writePlaylistEntrySong`) with its
 * video id, title, artists and length.
 */
export const playlistEntrySong = (fields: {
  readonly songId: string | null;
  readonly ytSong: string | null;
}): EntrySong => {
  if (fields.songId !== null) return { ...NO_SONG, recordingKey: fields.songId };
  const stored = fields.ytSong === null ? null : readPlaylistEntrySong(fields.ytSong);
  if (stored === null) return NO_SONG;
  const { title, artists, durationMs } = stored.song;
  return {
    recordingKey: null,
    videoId: stored.source === "stream" ? stored.song.videoId : null,
    title,
    artists,
    durationMs,
  };
};

/** An entry as the rule reads it. */
export interface DuplicateCandidate {
  readonly id: string;
  readonly playlistId: string;
  readonly addedAt: number;
  /** A removed entry is never compared. */
  readonly deleted: boolean;
  readonly song: EntrySong;
}

const knownLength = (ms: number | null): ms is number => ms !== null && ms > 0;

/** Whether two entries' songs are one by title, a shared artist and length: both must carry each. */
const sameByTags = (a: EntrySong, b: EntrySong): boolean =>
  a.title !== null &&
  b.title !== null &&
  a.artists.length > 0 &&
  b.artists.length > 0 &&
  knownLength(a.durationMs) &&
  knownLength(b.durationMs) &&
  recordingMatches(
    { title: a.title, artist: joinArtists(a.artists), durationMs: a.durationMs },
    { title: b.title, artists: b.artists, durationMs: b.durationMs },
  );

/** Whether two entries are of one song: one video id, one recording key, or matching tags. */
export const sameEntrySong = (a: EntrySong, b: EntrySong): boolean =>
  (a.videoId !== null && a.videoId === b.videoId) ||
  (a.recordingKey !== null && a.recordingKey === b.recordingKey) ||
  sameByTags(a, b);

const firstAdded = (a: DuplicateCandidate, b: DuplicateCandidate): number =>
  a.addedAt !== b.addedAt ? a.addedAt - b.addedAt : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

/** What a playlist holds so far, indexed for the comparisons. */
interface Kept {
  readonly videoIds: Set<string>;
  readonly recordingKeys: Set<string>;
  readonly byTitle: Map<string, EntrySong[]>;
}

const holds = (kept: Kept, song: EntrySong): boolean => {
  if (song.videoId !== null && kept.videoIds.has(song.videoId)) return true;
  if (song.recordingKey !== null && kept.recordingKeys.has(song.recordingKey)) return true;
  if (song.title === null) return false;
  const same = kept.byTitle.get(recordingMatchTitle(song.title)) ?? [];
  return same.some((other) => sameByTags(other, song));
};

const keep = (kept: Kept, song: EntrySong): void => {
  if (song.videoId !== null) kept.videoIds.add(song.videoId);
  if (song.recordingKey !== null) kept.recordingKeys.add(song.recordingKey);
  if (song.title === null) return;
  const title = recordingMatchTitle(song.title);
  const same = kept.byTitle.get(title);
  if (same === undefined) kept.byTitle.set(title, [song]);
  else same.push(song);
};

/**
 * The entries a device removes so each playlist keeps one entry per song:
 * going through each playlist's live entries in the order they were added
 * (the lower entry id first among those added at once), an entry of a song
 * an entry kept before it holds goes; an entry that goes holds nothing. The
 * answer doesn't depend on the order [entries] come in; it is in id order.
 */
export const duplicatePlaylistEntries = <E extends DuplicateCandidate>(
  entries: readonly E[],
): E[] => {
  // oxlint-disable-next-line unicorn/no-array-sort -- sorts a fresh array; Hermes lacks toSorted
  const live = entries.filter((candidate) => !candidate.deleted).sort(firstAdded);
  const playlists = new Map<string, Kept>();
  const goes: E[] = [];
  for (const candidate of live) {
    let kept = playlists.get(candidate.playlistId);
    if (kept === undefined) {
      kept = { videoIds: new Set(), recordingKeys: new Set(), byTitle: new Map() };
      playlists.set(candidate.playlistId, kept);
    }
    if (holds(kept, candidate.song)) goes.push(candidate);
    else keep(kept, candidate.song);
  }
  // oxlint-disable-next-line unicorn/no-array-sort -- sorts a fresh array; Hermes lacks toSorted
  return goes.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
};
