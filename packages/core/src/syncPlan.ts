/**
 * Translating between the phone's Library and the Wave account (docs/spec.md,
 * "Wave account and sync"): which Track an account song is on this phone,
 * which of the phone's songs go up, and the ids imported plays carry.
 */

import { normalizeTrack, type LibraryTrack } from "./library.ts";
import { findRecording, joinLibraries } from "./sync.ts";
import type { SyncSong, SyncSongFields } from "./syncWire.ts";

/** A Track as the account's songs map onto it. */
export interface KeyedTrack<Id> {
  readonly id: Id;
  /** Null only before the store keyed it. */
  readonly recordingKey: string | null;
  readonly durationMs: number;
}

/**
 * Which of the phone's [tracks] each recording key is, for the rows the
 * account sends down (favorites, entries, plays name songs by key). Among
 * Tracks with one key, the [account] song's length picks (`findRecording`);
 * when it can't, the first stands for them, since the phone's files with one
 * key are one song for the account.
 */
export const accountTrackIds = <Id>(
  tracks: readonly KeyedTrack<Id>[],
  account: readonly { readonly recordingKey: string; readonly durationMs: number }[],
): Map<string, Id> => {
  const byKey = new Map<string, { recordingKey: string; durationMs: number; id: Id }[]>();
  for (const track of tracks) {
    if (track.recordingKey === null) continue;
    const keyed = { recordingKey: track.recordingKey, durationMs: track.durationMs, id: track.id };
    const same = byKey.get(track.recordingKey);
    if (same === undefined) byKey.set(track.recordingKey, [keyed]);
    else same.push(keyed);
  }
  const lengths = new Map(account.map((song) => [song.recordingKey, song.durationMs]));
  const ids = new Map<string, Id>();
  for (const [key, same] of byKey) {
    const length = lengths.get(key);
    const picked =
      same.length > 1 && length !== undefined
        ? findRecording({ recordingKey: key, durationMs: length }, same)
        : null;
    const track = picked ?? same[0];
    if (track !== undefined) ids.set(key, track.id);
  }
  return ids;
};

/** One of the phone's songs (a Track with a file) as it would go up. */
export interface PhoneSong {
  readonly recordingKey: string;
  readonly fields: SyncSongFields;
}

/** What the phone knows of one account song. */
export interface AccountSongState {
  /** The account's row, as last pulled or pushed. */
  readonly row: SyncSong;
  /**
   * The phone's own song with this key when it last synced (`SongSyncPlan`'s
   * `local`), or null when the phone had none then.
   */
  readonly local: string | null;
}

/** What `planSongSync` decides. */
export interface SongSyncPlan {
  /** The songs that go up, stamped by this phone. */
  readonly push: readonly SyncSong[];
  /** For each song whose state changed, what to remember of the phone's own (opaque; null: none). */
  readonly local: readonly { readonly recordingKey: string; readonly local: string | null }[];
}

/** The song's fields in one fixed order, so the same tags always give the same text. */
const songText = (fields: SyncSongFields): string =>
  JSON.stringify([
    fields.title,
    fields.credit,
    fields.album,
    fields.albumArtist,
    fields.discNumber,
    fields.trackNumber,
    fields.durationMs,
    fields.year,
    fields.genre,
    fields.videoId,
    fields.addedAt,
  ]);

/**
 * Which of the phone's [phone] songs go up to the account, given what it
 * knows of the [account]'s (Core's `joinLibraries`: joined, never replaced).
 * A song the account lacks goes up. A song the account has already is the
 * account's: the phone's tags go up only once they change on the phone
 * (say, a retag), so two phones whose files differ don't overwrite each
 * other forever. A song whose file is gone stays in the account, as only
 * removing it in Wave takes it out. One the account removed comes back
 * when the phone has its file and hadn't synced it since.
 */
export const planSongSync = (input: {
  readonly phone: readonly PhoneSong[];
  readonly account: readonly AccountSongState[];
  readonly now: number;
  readonly phoneId: string;
}): SongSyncPlan => {
  const known = new Map(input.account.map((state) => [state.row.id, state]));
  // Tombstones join too: the account still knows the song, and a phone that
  // brings it back has to stamp after the removal.
  const join = joinLibraries({
    phone: { songs: input.phone, playlists: [] },
    account: {
      songs: input.account.map((state) => ({ recordingKey: state.row.id })),
      playlists: [],
    },
  });
  const push: SyncSong[] = [];
  const local: { recordingKey: string; local: string | null }[] = [];
  const stamp = (song: PhoneSong, after: number): SyncSong => ({
    id: song.recordingKey,
    changedAt: Math.max(input.now, after + 1),
    phoneId: input.phoneId,
    deleted: false,
    ...song.fields,
  });

  for (const song of join.up) {
    push.push(stamp(song, 0));
    local.push({ recordingKey: song.recordingKey, local: songText(song.fields) });
  }
  for (const { account, phone } of join.tracks) {
    const song = phone[0];
    const state = known.get(account.recordingKey);
    if (song === undefined || state === undefined) continue;
    const text = songText(song.fields);
    if (state.local === text) continue;
    const changedHere = state.local !== null;
    if (changedHere || state.row.deleted) push.push(stamp(song, state.row.changedAt));
    local.push({ recordingKey: song.recordingKey, local: text });
  }
  const onPhone = new Set(input.phone.map((song) => song.recordingKey));
  for (const state of input.account) {
    if (state.local !== null && !onPhone.has(state.row.id)) {
      local.push({ recordingKey: state.row.id, local: null });
    }
  }
  return { push, local };
};

/** A missing song's tags as the Library stores a Track's, without the file a Track has. */
export type MissingSongTrack = Omit<LibraryTrack, "path" | "folder" | "fileName">;

/**
 * The Track an account song the phone has no file for comes in as (a
 * missing song): its tags read as a scan reads a file's, so it files under
 * the album, artists and genre a scanned copy would, and sorts where one would.
 */
export const missingSongTrack = (song: SyncSongFields): MissingSongTrack => {
  const {
    path: _path,
    folder: _folder,
    fileName: _fileName,
    ...track
  } = normalizeTrack({
    path: "",
    title: song.title,
    artist: song.credit,
    album: song.album,
    albumArtist: song.albumArtist,
    genre: song.genre,
    year: song.year === null ? null : String(song.year),
    trackNumber: song.trackNumber === null ? null : String(song.trackNumber),
    discNumber: song.discNumber === null ? null : String(song.discNumber),
    durationMs: song.durationMs,
  });
  return track;
};

/**
 * The id of a song's [ordinal]-th play imported from BlackPlayer (from 1, in
 * the order they were played). BlackPlayer's counts are cumulative, so the
 * n-th play is the same play on every phone that imports it: it goes up once.
 */
export const blackPlayerPlayId = (recordingKey: string, ordinal: number): string =>
  `blackplayer:${ordinal}:${recordingKey}`;
