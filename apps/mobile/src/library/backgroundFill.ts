/**
 * The background fill (docs/spec.md, "Importing playlists from a link",
 * Background fill): while Wave runs, on screen or playing in the
 * background, it searches the unsearched entries nobody has played or
 * downloaded, so imported playlists settle over time. Core decides which
 * song goes next, when to wait and what a failure does (`nextFillStep`,
 * `fillAnswered`); each search waits its turn in the shared allowance as the
 * fill, its lowest asker, and settles as playing's does
 * (`searchUnsearchedSong`). No notification and no service: it stops when
 * Android stops Wave.
 */
import {
  FILL_LOOK_AGAIN_MS,
  NO_FILL,
  fillAnswered,
  fillPauseLine,
  nextFillStep,
  unsearchedTrackId,
  type BackgroundFill,
  type FillPlaylist,
  type UnsearchedSettlement,
  type UnsearchedSong,
  type YtAlbumSong,
} from "@wave/core";
import * as Effect from "effect/Effect";

import { appLog } from "@/log/appLog";
import { ytMusicEnabled } from "@/settings/ytMusic";
import { downloadsOnTheirWay, onDownloadsChanged } from "@/ytmusic/YtDownloads";

import type { PlaylistUnsearched } from "./db/playlists";
import { LibraryStore } from "./LibraryStore";
import { onPlaylistsEdited } from "./playlists";
import { appRuntime } from "./runtime";
import { searchUnsearchedSong } from "./unsearchedEntries";

/** The app log's tag, the search allowance's. */
const TAG = "WaveSearch";

/**
 * The playlists are read again at most this often while they change: the
 * fill's own answers change them once a second, and it drops what it
 * settled from what it read.
 */
const READ_AGAIN_MS = 15_000;

let fill: BackgroundFill = NO_FILL;

/** Each playlist's unsearched songs as last read, and when each was last played from. */
let known: {
  readonly playlists: readonly PlaylistUnsearched[];
  readonly lastPlayed: ReadonlyMap<number, number>;
} | null = null;
/** When the playlists were last read (ms). */
let readAt = 0;
/** Whether the playlists changed since they were read. */
let stale = true;
/** When each playlist was opened while Wave runs (ms). */
const opened = new Map<number, number>();

let timer: ReturnType<typeof setTimeout> | undefined;
/** A step is going on (a read or a search); a kick meanwhile runs another after it. */
let busy = false;
let again = false;
/** Gives up the fill's turn in the allowance while it still waits for it. */
let searching: AbortController | null = null;
let started = false;

const readPlaylists = async (): Promise<void> => {
  stale = false;
  readAt = Date.now();
  known = await appRuntime.runPromise(
    // oxlint-disable-next-line react/rules-of-hooks -- Effect Service.use resolves a service; it is not a React Hook.
    LibraryStore.use((store) =>
      store.unsearchedEntries.pipe(
        Effect.zip(store.playlistsLastPlayed),
        Effect.map(([playlists, lastPlayed]) => ({ playlists, lastPlayed })),
      ),
    ),
  );
};

/** The playlists as the fill sees them: when each was last opened or played from. */
const fillPlaylists = (): FillPlaylist[] =>
  (known?.playlists ?? []).map(({ playlistId, songs }) => {
    const used = [opened.get(playlistId), known?.lastPlayed.get(playlistId)].filter(
      (at): at is number => at !== undefined,
    );
    return { id: playlistId, usedAt: used.length === 0 ? null : Math.max(...used), songs };
  });

/** What was read without [song], which a search just settled in every playlist. */
const drop = (song: UnsearchedSong): void => {
  if (known === null) return;
  const key = unsearchedTrackId(song);
  known = {
    ...known,
    playlists: known.playlists.map((playlist) => ({
      ...playlist,
      songs: playlist.songs.filter((one) => unsearchedTrackId(one) !== key),
    })),
  };
};

/** Searches [song] as the fill and takes in what it settled. */
const search = async (song: UnsearchedSong): Promise<void> => {
  const controller = new AbortController();
  searching = controller;
  const settled = await searchUnsearchedSong(song, "fill", controller.signal).catch(
    (): UnsearchedSettlement<YtAlbumSong> => ({ kind: "failed", reason: "failed" }),
  );
  searching = null;
  // Given up before its turn: a download started.
  if (settled === null) return;
  const answered = fillAnswered(fill, song, settled, Date.now());
  fill = answered.fill;
  if (answered.pause !== null) appLog("warn", TAG, fillPauseLine(answered.pause));
  if (settled.kind !== "failed") drop(song);
};

const later = (ms: number): void => {
  clearTimeout(timer);
  timer = setTimeout(kick, Math.max(0, ms));
};

/** Takes the fill's next step: reads the playlists when due, then searches, waits or rests. */
const step = async (): Promise<void> => {
  const downloading = downloadsOnTheirWay();
  if (!downloading) {
    const due = known === null || (stale && (Date.now() - readAt >= READ_AGAIN_MS || isEmpty()));
    if (due) await readPlaylists();
  }
  const world = { playlists: fillPlaylists(), downloading, ytMusicOn: ytMusicEnabled() };
  const now = Date.now();
  const next = nextFillStep(fill, world, now);
  fill = next.fill;
  switch (next.step.kind) {
    case "search":
      await search(next.step.song);
      later(0);
      return;
    case "wait":
      later(next.step.until - now);
      return;
    case "idle":
      // Nothing left in what was read: what changed since is read once it may be.
      if (stale && !downloading) later(readAt + READ_AGAIN_MS - now);
      return;
  }
};

/** Whether what was read holds no song left. */
const isEmpty = (): boolean => known?.playlists.every(({ songs }) => songs.length === 0) ?? true;

/** Runs a step now, or once the one going on ends. */
const kick = (): void => {
  if (busy) {
    again = true;
    return;
  }
  clearTimeout(timer);
  timer = undefined;
  busy = true;
  again = false;
  step()
    .catch(() => later(FILL_LOOK_AGAIN_MS))
    .finally(() => {
      busy = false;
      if (again) kick();
    });
};

/**
 * The playlist [playlistId] was opened: the fill goes on with its songs.
 * One the fill hasn't read yet (imported since) is read now.
 */
export const playlistOpened = (playlistId: number, settled: boolean): void => {
  if (!settled) return;
  opened.set(playlistId, Date.now());
  if (!(known?.playlists.some((playlist) => playlist.playlistId === playlistId) ?? false))
    readAt = 0;
  if (started) kick();
};

/** Starts the background fill. Call it once per JS runtime. */
export const startBackgroundFill = (): void => {
  if (started) return;
  started = true;
  onPlaylistsEdited(() => {
    stale = true;
    kick();
  });
  onDownloadsChanged(() => {
    // Downloads go first: a turn still waiting is given up.
    if (downloadsOnTheirWay()) searching?.abort();
    kick();
  });
  kick();
};
