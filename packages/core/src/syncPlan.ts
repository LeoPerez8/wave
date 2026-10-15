/**
 * Translating between the phone's Library and the Wave account (docs/spec.md,
 * "Wave account and sync"): which Track an account song is on this phone,
 * which of the phone's songs go up, which of the account's come down as
 * missing songs, and the ids imported plays carry.
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

/** A missing song to save: an account song the phone has no file for. */
export interface MissingSongSave {
  /** Its Track, when it's in the Library already (its tags are brought up to date); null for a new one. */
  readonly trackId: number | null;
  /** The account's recording key for it. */
  readonly recordingKey: string;
  /** Its tags (`missingSongTrack`). */
  readonly track: MissingSongTrack;
  readonly videoId: string | null;
  /** When it entered the Library, on the phone that first had it. */
  readonly addedAt: number;
}

/** A missing song as the Library shows it: its Track, and the tags read back from it. */
export interface ShownMissingSong {
  readonly id: number;
  readonly recordingKey: string | null;
  readonly title: string;
  readonly artist: string;
  readonly album: string;
  readonly albumArtist: string;
  readonly genre: string | null;
  readonly year: number | null;
  readonly trackNumber: number | null;
  readonly discNumber: number | null;
  readonly durationMs: number;
  readonly videoId: string | null;
}

/** What a missing song shows of its account song, to tell when the account's tags changed. */
const shownTags = (song: Omit<ShownMissingSong, "id" | "recordingKey">): string =>
  JSON.stringify([
    song.title,
    song.artist,
    song.album,
    song.albumArtist,
    song.genre,
    song.year,
    song.trackNumber,
    song.discNumber,
    song.durationMs,
    song.videoId,
  ]);

/** What `planMissingSongs` decides. */
export interface MissingSongsPlan {
  /** Account songs no Track has (new), and missing songs whose account tags changed. */
  readonly save: readonly MissingSongSave[];
  /** The Tracks of the missing songs that leave the Library. */
  readonly leave: readonly number[];
  /** Tags changed or songs left: albums, artists and genres may be left empty. */
  readonly prune: boolean;
}

/**
 * Brings the Library's [missing] songs in line with the [account]'s songs
 * (its live ones, as last pulled): an account song no Track has ([held]:
 * every Track's recording key, missing songs' too) comes in as a missing
 * song, a missing song takes the account's tags when they changed on
 * another phone, and one the account no longer has (removed there, or never
 * sent up) leaves. Tracks with a file are never touched.
 */
export const planMissingSongs = (input: {
  readonly account: readonly { readonly recordingKey: string; readonly song: SyncSongFields }[];
  readonly held: readonly string[];
  readonly missing: readonly ShownMissingSong[];
}): MissingSongsPlan => {
  const live = new Map(input.account.map(({ recordingKey, song }) => [recordingKey, song]));
  const held = new Set(input.held);
  const save: MissingSongSave[] = [];
  const leave: number[] = [];
  for (const shown of input.missing) {
    const song = shown.recordingKey === null ? undefined : live.get(shown.recordingKey);
    if (song === undefined || shown.recordingKey === null) {
      leave.push(shown.id);
      continue;
    }
    const track = missingSongTrack(song);
    if (shownTags(shown) === shownTags({ ...track, videoId: song.videoId })) continue;
    save.push({
      trackId: shown.id,
      recordingKey: shown.recordingKey,
      track,
      videoId: song.videoId,
      addedAt: song.addedAt,
    });
  }
  const retagged = save.length > 0;
  for (const { recordingKey, song } of input.account) {
    if (held.has(recordingKey)) continue;
    save.push({
      trackId: null,
      recordingKey,
      track: missingSongTrack(song),
      videoId: song.videoId,
      addedAt: song.addedAt,
    });
  }
  return { save, leave, prune: retagged || leave.length > 0 };
};

/**
 * The id of a song's [ordinal]-th play imported from BlackPlayer (from 1, in
 * the order they were played). BlackPlayer's counts are cumulative, so the
 * n-th play is the same play on every phone that imports it: it goes up once.
 */
export const blackPlayerPlayId = (recordingKey: string, ordinal: number): string =>
  `blackplayer:${ordinal}:${recordingKey}`;
