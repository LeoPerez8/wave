import {
  missingSongJobId,
  songRowTrackId,
  type AppLanguage,
  type SongRowState,
  type YtDownloadStatus,
} from "@wave/core";

import type { SongListEntry } from "./songListSources.ts";

/** What a song list follows once for all its rows. */
export interface SongListSnapshot {
  /** The playing song's queue ids. */
  readonly playing: ReadonlySet<string>;
  readonly favorites: ReadonlySet<number>;
  /** Starred YT Music songs waiting for their files, by video. */
  readonly pending: ReadonlySet<string>;
  /** A download job's status (a video, a missing song's or an unsearched song's job). */
  readonly download: (job: string) => YtDownloadStatus | null;
  readonly ytMusic: boolean;
  /** Videos that refused to play this session. */
  readonly unplayable: ReadonlySet<string>;
  /** The language rows read in; English unless given. */
  readonly language?: AppLanguage;
}

const downloadJob = (entry: SongListEntry, trackId: string): string | null => {
  const { source } = entry;
  if (source.kind === "ytMusic") return source.song.videoId;
  if (source.kind === "unsearched") return trackId;
  return entry.facts?.missing === true ? missingSongJobId(Number(trackId)) : null;
};

/**
 * One row's state from what its list follows: playing, starred, its download
 * and, for a ranked stream (`gated`), whether it can play now. What the entry
 * states itself (a history row's no star) wins. [selection] is the row's
 * check state while its list selects.
 */
export const songRowState = (
  entry: SongListEntry,
  key: string,
  list: SongListSnapshot,
  selection: NonNullable<SongRowState["selection"]> = "off",
): { readonly state: SongRowState; readonly blocked: boolean } => {
  const { source } = entry;
  const trackId = songRowTrackId(source) ?? key;
  const plays = source.kind !== "unavailable";
  const starred =
    source.kind === "ytMusic"
      ? list.pending.has(source.song.videoId)
      : source.kind === "unsearched" || source.kind === "unavailable"
        ? false
        : list.favorites.has(Number(trackId));
  const job = downloadJob(entry, trackId);
  const blocked =
    entry.gated === true &&
    source.kind === "ytMusic" &&
    (!list.ytMusic || list.unplayable.has(source.song.videoId));
  return {
    state: {
      playing: plays && list.playing.has(trackId),
      starred,
      download: job === null ? null : list.download(job),
      remoteArtwork: list.ytMusic,
      selection,
      language: list.language,
      ...(blocked ? { unavailable: true } : {}),
      ...entry.state,
    },
    blocked,
  };
};

/**
 * Each song's key: its id, and for a real duplicate the id with its
 * occurrence (Core's `songRowView` key), never its index, so a list that
 * fills in keeps its rows' keys.
 */
export const occurrenceKeys = <T>(
  songs: readonly T[],
  idOf: (song: T) => string,
): ReadonlyMap<T, string> => {
  const seen = new Map<string, number>();
  const keys = new Map<T, string>();
  for (const song of songs) {
    const id = idOf(song);
    const occurrence = seen.get(id) ?? 0;
    seen.set(id, occurrence + 1);
    keys.set(song, occurrence === 0 ? id : `${id}:occurrence:${occurrence}`);
  }
  return keys;
};
