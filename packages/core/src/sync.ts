/**
 * Sync: the rules a Wave account syncs by (docs/spec.md, "Wave account and
 * sync"). The app and the sync service both merge with them, so the two sides
 * always agree.
 */

import { UNKNOWN_ALBUM, albumKey } from "./library.ts";
import { normalizeSearchText } from "./search.ts";

/** The tags a song's recording key is built from. A `LibraryTrack` has them all. */
export interface RecordingTags {
  readonly title: string;
  /** The album title; `null`, empty or "Unknown Album" when the file has no album tag. */
  readonly album: string | null;
  readonly albumArtist: string;
  readonly discNumber: number | null;
  readonly trackNumber: number | null;
}

const SEPARATOR = "\u001f";

/**
 * What makes two songs on different phones the same song for a Wave account:
 * the album's identity (title + album artist, as the Library groups albums),
 * the title with case, accents and punctuation aside (as Search compares), and
 * the disc and track number when the file has a track number (no disc counts
 * as disc 1). A song with no album tag keys on its album artist and title.
 *
 * The key is stored on both sides, so changing how it's built is a migration.
 */
export const recordingKey = (song: RecordingTags): string => {
  const album = song.album === null || song.album === UNKNOWN_ALBUM ? "" : song.album;
  const parts = [albumKey(album, song.albumArtist), normalizeSearchText(song.title)];
  if (album !== "" && song.trackNumber !== null) {
    parts.push(`${song.discNumber ?? 1}.${song.trackNumber}`);
  }
  return parts.join(SEPARATOR);
};

/** A song as matching by recording sees it: its key (`recordingKey`) and its length. */
export interface Recording {
  readonly recordingKey: string;
  readonly durationMs: number;
}

/** How far apart two lengths can be for one recording, when length has to break a tie. */
export const RECORDING_LENGTH_TOLERANCE_MS = 3_000;

/**
 * Which of [candidates] is [song]: the one with its recording key. When
 * several have the key, length breaks the tie: the one within 3 seconds of
 * the song's length wins, and none does when that leaves more or fewer than one.
 */
export const findRecording = <C extends Recording>(
  song: Recording,
  candidates: readonly C[],
): C | null => {
  const sameKey = candidates.filter((candidate) => candidate.recordingKey === song.recordingKey);
  if (sameKey.length <= 1) return sameKey[0] ?? null;
  const close = sameKey.filter(
    (candidate) =>
      Math.abs(candidate.durationMs - song.durationMs) <= RECORDING_LENGTH_TOLERANCE_MS,
  );
  return close.length === 1 ? (close[0] ?? null) : null;
};

/**
 * What every synced row carries besides its own fields (songs, playlists,
 * playlist entries, favorites, preferences). Removing a row doesn't drop it:
 * it becomes a tombstone (`deleted: true`), which merges like any other change.
 */
export interface SyncRow {
  /** The row's id, the same on every phone (a song's is its recording key). */
  readonly id: string;
  /**
   * When the row last changed, in ms since the epoch, by the clock of the phone
   * that changed it. A phone never stamps two changes of one row with the same time.
   */
  readonly changedAt: number;
  /** The id of the phone that made the change. */
  readonly phoneId: string;
  /** Whether the change removed the row. */
  readonly deleted: boolean;
}

/**
 * Whether change [a] wins over change [b] of the same row: the later one wins,
 * the greater phone id (compared as text) when they were made at the same
 * time, and the removal when they are the same change.
 */
const wins = (a: SyncRow, b: SyncRow): boolean => {
  if (a.changedAt !== b.changedAt) return a.changedAt > b.changedAt;
  if (a.phoneId !== b.phoneId) return a.phoneId > b.phoneId;
  return a.deleted && !b.deleted;
};

/** What `mergeRows` gives. */
export interface MergedRows<R extends SyncRow> {
  /** One row per id, the winning change of each, in id order (compared as text). */
  readonly rows: readonly R[];
  /**
   * The incoming rows that won, one per id in id order: what the side merging
   * has to write (the service stores them, the app applies them).
   */
  readonly accepted: readonly R[];
}

const byId = (a: SyncRow, b: SyncRow): number => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/**
 * Merges [incoming] changes into the [current] rows, row by row: the later
 * change wins and the phone id breaks a tie (`SyncRow`). A tombstone is a
 * change like any other, so an older edit arriving late can't undo a removal,
 * while an edit made after it brings the row back. The result doesn't depend
 * on the order the changes arrive in, nor on which side holds which.
 */
export const mergeRows = <R extends SyncRow>(
  current: readonly R[],
  incoming: readonly R[],
): MergedRows<R> => {
  const winners = new Map<string, R>();
  for (const row of current) {
    const held = winners.get(row.id);
    if (held === undefined || wins(row, held)) winners.set(row.id, row);
  }
  const accepted = new Map<string, R>();
  for (const row of incoming) {
    const held = winners.get(row.id);
    if (held === undefined || wins(row, held)) {
      winners.set(row.id, row);
      accepted.set(row.id, row);
    }
  }
  return {
    rows: [...winners.values()].sort(byId),
    accepted: [...accepted.values()].sort(byId),
  };
};

/** A synced play event: its id is made on the phone that recorded it, and is the same everywhere. */
export interface SyncPlay {
  readonly id: string;
}

/** What `mergePlays` gives. */
export interface MergedPlays<P extends SyncPlay> {
  /** The plays held, then those added, in the order they came. */
  readonly plays: readonly P[];
  /** The incoming plays not held before: what the side merging has to write. */
  readonly added: readonly P[];
}

/**
 * Merges play events by id only: a play is only ever added, never changed,
 * and never held twice. An incoming play whose id is already held is ignored.
 */
export const mergePlays = <P extends SyncPlay>(
  current: readonly P[],
  incoming: readonly P[],
): MergedPlays<P> => {
  const held = new Set(current.map((play) => play.id));
  const added: P[] = [];
  for (const play of incoming) {
    if (held.has(play.id)) continue;
    held.add(play.id);
    added.push(play);
  }
  return { plays: [...current, ...added], added };
};

/** A song as the first sign-in joins it: a phone's Track or an account song, known by its recording key. */
export interface KeyedSong {
  readonly recordingKey: string;
}

/** One side of the first sign-in: its songs and its playlists. */
export interface LibrarySide<S extends KeyedSong, L extends SyncRow> {
  /** The phone's Tracks with a file, or the account's songs (without tombstones). */
  readonly songs: readonly S[];
  /** The playlists as synced rows, tombstones included. */
  readonly playlists: readonly L[];
}

/** An account song the phone has: every Track of the phone with its recording key. */
export interface JoinedTrack<P extends KeyedSong, A extends KeyedSong> {
  readonly account: A;
  readonly phone: readonly P[];
}

/** What the first sign-in on a phone with a Library does. Nothing on either side is dropped. */
export interface LibraryJoin<P extends KeyedSong, A extends KeyedSong, L extends SyncRow> {
  /** The account's songs the phone has, in the account's order. */
  readonly tracks: readonly JoinedTrack<P, A>[];
  /** The account's songs the phone has no file for: they come in as missing songs. */
  readonly missing: readonly A[];
  /**
   * The phone's songs the account lacks, which go up: one per recording key,
   * the first in the phone's order, since the phone's files with one key are
   * one song for the account.
   */
  readonly up: readonly P[];
  /** The phone's playlist changes the account doesn't have yet. */
  readonly playlistsUp: readonly L[];
  /** The account's playlist changes the phone doesn't have yet. */
  readonly playlistsDown: readonly L[];
}

/**
 * Joins the phone's Library and the account's at the first sign-in (or a
 * sign-in after signing out): the two are joined, never replaced. Songs meet
 * by recording key. Playlists meet by id only, so two with the same name stay
 * two; one both sides have from an earlier sign-in merges as `mergeRows` does.
 */
export const joinLibraries = <P extends KeyedSong, A extends KeyedSong, L extends SyncRow>(input: {
  readonly phone: LibrarySide<P, L>;
  readonly account: LibrarySide<A, L>;
}): LibraryJoin<P, A, L> => {
  const phoneByKey = new Map<string, P[]>();
  for (const song of input.phone.songs) {
    const same = phoneByKey.get(song.recordingKey);
    if (same === undefined) phoneByKey.set(song.recordingKey, [song]);
    else same.push(song);
  }
  const tracks: JoinedTrack<P, A>[] = [];
  const missing: A[] = [];
  const accountKeys = new Set<string>();
  for (const song of input.account.songs) {
    accountKeys.add(song.recordingKey);
    const phone = phoneByKey.get(song.recordingKey);
    if (phone === undefined) missing.push(song);
    else tracks.push({ account: song, phone });
  }
  const up: P[] = [];
  for (const [key, songs] of phoneByKey) {
    const first = songs[0];
    if (!accountKeys.has(key) && first !== undefined) up.push(first);
  }
  return {
    tracks,
    missing,
    up,
    playlistsUp: mergeRows(input.account.playlists, input.phone.playlists).accepted,
    playlistsDown: mergeRows(input.phone.playlists, input.account.playlists).accepted,
  };
};

/** What becomes of a song whose file a scan no longer finds. */
export type VanishedFileFate =
  /** It stays as a missing song, with its favorites, playlist entries and plays. */
  | "missing"
  /** It leaves the Library, as before Wave accounts. */
  | "remove";

/** What a scan does with a file it no longer finds: keeps its song missing while signed in, removes it while signed out. */
export const vanishedFile = (state: { readonly signedIn: boolean }): VanishedFileFate =>
  state.signedIn ? "missing" : "remove";

/** A file a scan found that fills a missing song in. */
export interface FilledSong<F extends Recording, M extends Recording> {
  readonly file: F;
  readonly song: M;
}

/** What `fillMissingSongs` gives. */
export interface MissingSongsFill<F extends Recording, M extends Recording> {
  /** The files that fill a missing song in: the song gets the file, and stays the same Track. */
  readonly filled: readonly FilledSong<F, M>[];
  /** The files that fill nothing: they're added as new Tracks. */
  readonly added: readonly F[];
}

/**
 * Which missing songs the new files a scan [found] fill in, so files Syncthing
 * brings never show twice. A file fills the missing song `findRecording`
 * picks for it among those not filled yet (length breaks a tie between
 * missing songs with one key), in the order the files came; each missing
 * song is filled once.
 */
export const fillMissingSongs = <F extends Recording, M extends Recording>(
  found: readonly F[],
  missing: readonly M[],
): MissingSongsFill<F, M> => {
  let open = [...missing];
  const filled: FilledSong<F, M>[] = [];
  const added: F[] = [];
  for (const file of found) {
    const song = findRecording(file, open);
    if (song === null) {
      added.push(file);
    } else {
      filled.push({ file, song });
      open = open.filter((candidate) => candidate !== song);
    }
  }
  return { filled, added };
};
