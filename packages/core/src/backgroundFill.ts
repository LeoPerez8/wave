/**
 * The background fill (docs/spec.md, "Importing playlists from a link",
 * Background fill): while Wave runs, it searches the unsearched entries
 * nobody has played or downloaded, so imported playlists settle over time.
 * Which song goes next, when the fill waits, and what a failed search does.
 * Each search then waits its turn in the shared allowance as the fill
 * (`searchTurns`), and settles as any search does (`settleUnsearched`).
 */

import { unsearchedTrackId, type UnsearchedSong } from "./playlistEntries.ts";
import { finishSteps } from "./buildSteps.ts";
import { logDuration, type SearchFailure } from "./searchAllowance.ts";

/** The fill asks at most one search a second. */
export const FILL_PACE_MS = 1000;

/** With YT Music off, or Wave offline, the fill looks again this much later. */
export const FILL_LOOK_AGAIN_MS = 60_000;

/** A song whose search failed is asked again no sooner than this. */
export const FILL_RETRY_MS = 60_000;

/** This many different searches refused in a row pause the fill. */
export const FILL_REFUSALS = 3;

/**
 * The pauses after refusals, each one longer, the last repeated until an
 * answer comes. Measured on 2026-10-14, YouTube Music refused about one
 * search in eight once throttling, never more than three in a row, and kept
 * refusing a few for over half an hour.
 */
export const FILL_PAUSES_MS: readonly number[] = [
  2000,
  5000,
  10_000,
  20_000,
  60_000,
  2 * 60_000,
  5 * 60_000,
  10 * 60_000,
  15 * 60_000,
];

/** A playlist with unsearched entries, as the fill sees it. */
export interface FillPlaylist {
  readonly id: number;
  /** When it was last opened or played from (ms); null when never. */
  readonly usedAt: number | null;
  /** Its unsearched songs, top to bottom. */
  readonly songs: readonly UnsearchedSong[];
}

/** What the fill keeps between searches. */
export interface BackgroundFill {
  /** When it last asked a search (ms), for its pace. */
  readonly askedAt: number | null;
  /**
   * When each song whose search failed did (ms), by `unsearchedTrackId`: it
   * waits at the back of its playlist's line, in the order they failed.
   */
  readonly failedAt: Readonly<Record<string, number>>;
  /** No search is asked before this time (ms): offline, or a pause after refusals. */
  readonly pausedUntil: number;
  /** The different songs whose search failed since the last answer, by `unsearchedTrackId`. */
  readonly refused: readonly string[];
  /** How many pauses the fill took since the last answer. */
  readonly pauses: number;
}

/** The fill before it has searched anything. */
export const NO_FILL: BackgroundFill = {
  askedAt: null,
  failedAt: {},
  pausedUntil: 0,
  refused: [],
  pauses: 0,
};

/** What the fill sees around it. */
export interface FillWorld {
  readonly playlists: readonly FillPlaylist[];
  /** Whether any download is queued or downloading. */
  readonly downloading: boolean;
  readonly ytMusicOn: boolean;
}

/** What the app does next for the fill. */
export type FillStep =
  /** Search this song, as the fill (`searchTurn("fill")`), then `fillAnswered` with what it settled. */
  | { readonly kind: "search"; readonly song: UnsearchedSong }
  /** Search nothing before this time (ms). */
  | { readonly kind: "wait"; readonly until: number }
  /** Search nothing until something changes: no song is left, or a download is on its way. */
  | { readonly kind: "idle" };

/** [playlists] in the fill's order: the one used last first, then by recency; never used, the newest. */
const inOrder = (playlists: readonly FillPlaylist[]): FillPlaylist[] =>
  playlists
    .slice()
    // oxlint-disable-next-line unicorn/no-array-sort -- sorts a fresh array; Hermes lacks toSorted
    .sort(
      (a, b) =>
        (b.usedAt ?? Number.NEGATIVE_INFINITY) - (a.usedAt ?? Number.NEGATIVE_INFINITY) ||
        b.id - a.id,
    );

/**
 * The first song of [playlist]'s line: its first song never failed, else the one that failed
 * first, with when it did. Reads the songs only up to its first one never failed, and works out
 * no key with nothing failed, so a step costs the same whatever a playlist holds.
 */
const headOf = (
  playlist: FillPlaylist,
  failedAt: BackgroundFill["failedAt"],
  anyFailed: boolean,
): { readonly song: UnsearchedSong; readonly failedAt: number | undefined } | null => {
  let earliest: { song: UnsearchedSong; failedAt: number } | null = null;
  for (const song of playlist.songs) {
    const at = anyFailed ? failedAt[unsearchedTrackId(song)] : undefined;
    if (at === undefined) return { song, failedAt: undefined };
    if (earliest === null || at < earliest.failedAt) earliest = { song, failedAt: at };
  }
  return earliest;
};

/**
 * What the fill does next in [world] at [now] (ms), and the fill once it
 * does: the next song of the playlist opened or played last, top to bottom,
 * then of the others, the most recently used first; one search a second;
 * nothing while a download is on its way or YT Music is off. A song whose
 * search failed waits at the back of its playlist's line, and is asked again
 * no sooner than `FILL_RETRY_MS` after.
 */
export const nextFillStep = (
  fill: BackgroundFill,
  world: FillWorld,
  now: number,
): { readonly fill: BackgroundFill; readonly step: FillStep } => {
  // Downloads go first: the app asks again once the download queue changes.
  if (world.downloading) return { fill, step: { kind: "idle" } };
  if (!world.ytMusicOn) return { fill, step: { kind: "wait", until: now + FILL_LOOK_AGAIN_MS } };
  let retryAt = Number.POSITIVE_INFINITY;
  const anyFailed = Object.keys(fill.failedAt).length > 0;
  for (const playlist of inOrder(world.playlists)) {
    // The rest of the line is due no sooner than its head: those that failed later come after.
    const entry = headOf(playlist, fill.failedAt, anyFailed);
    if (entry === null) continue;
    const due = entry.failedAt === undefined ? now : entry.failedAt + FILL_RETRY_MS;
    if (due > now) {
      retryAt = Math.min(retryAt, due);
      continue;
    }
    const paced = Math.max(fill.pausedUntil, (fill.askedAt ?? now - FILL_PACE_MS) + FILL_PACE_MS);
    if (now < paced) return { fill, step: { kind: "wait", until: paced } };
    return { fill: { ...fill, askedAt: now }, step: { kind: "search", song: entry.song } };
  }
  if (retryAt !== Number.POSITIVE_INFINITY) return { fill, step: { kind: "wait", until: retryAt } };
  return { fill, step: { kind: "idle" } };
};

/** What a search settled of a song, as the fill takes it (Core's `UnsearchedSettlement`). */
export type FillAnswer =
  | { readonly kind: "found" | "notFound" }
  | { readonly kind: "failed"; readonly reason: SearchFailure };

/** A pause after refusals, for the app log (`fillPauseLine`). */
export interface FillPause {
  readonly at: number;
  /** No search is asked before this time (ms). */
  readonly until: number;
  /** How many different searches YouTube Music refused in a row. */
  readonly refused: number;
}

/**
 * The fill once the search for [song] settled [answer] at [now] (ms), and
 * the pause it takes, if any. Found or not found, the song is settled and
 * leaves every line. Failed, it goes to the back of its playlist's line,
 * still unsearched; once `FILL_REFUSALS` different searches failed in a row,
 * the fill pauses (`FILL_PAUSES_MS`, the last repeated), and each further
 * one before an answer pauses it longer. Offline or with YT Music off, the
 * song keeps its place, and the fill looks again `FILL_LOOK_AGAIN_MS` later.
 */
export const fillAnswered = (
  fill: BackgroundFill,
  song: UnsearchedSong,
  answer: FillAnswer,
  now: number,
): { readonly fill: BackgroundFill; readonly pause: FillPause | null } => {
  if (answer.kind === "failed" && answer.reason !== "failed")
    return { fill: { ...fill, pausedUntil: now + FILL_LOOK_AGAIN_MS }, pause: null };
  const key = unsearchedTrackId(song);
  const { [key]: _settled, ...failedAt } = fill.failedAt;
  if (answer.kind !== "failed")
    return { fill: { ...fill, failedAt, refused: [], pauses: 0 }, pause: null };
  const refused = fill.refused.includes(key) ? fill.refused : [...fill.refused, key];
  const failed = { ...fill, failedAt: { ...failedAt, [key]: now }, refused };
  if (refused.length < FILL_REFUSALS) return { fill: failed, pause: null };
  const lasts = FILL_PAUSES_MS[Math.min(fill.pauses, FILL_PAUSES_MS.length - 1)] ?? 0;
  const until = Math.max(fill.pausedUntil, now + lasts);
  return {
    fill: { ...failed, pauses: fill.pauses + 1, pausedUntil: until },
    pause: { at: now, until, refused: refused.length },
  };
};

/** [ms] as a time of day in UTC, as the log's own times are: "13:14:00". */
const clock = (ms: number): string => new Date(ms).toISOString().slice(11, 19);

/** The app log's line for [pause]: how long, why, and when the fill goes on. */
// not UI text: the app log's line
export const fillPauseLine = (pause: FillPause): string =>
  `The background fill pauses for ${logDuration(pause.until - pause.at)}: YouTube Music refused ${pause.refused.toLocaleString("en")} different searches in a row; it goes on at ${clock(pause.until)} UTC`;

/** A read of the fill's playlists, indexed once so an answer removes only its own occurrences. */
export interface FillPlaylistsIndex {
  /** Whether the read held the playlist [id]. */
  readonly has: (id: number) => boolean;
  /** Whether no song of the read is left. */
  readonly empty: () => boolean;
  /** Leaves out [song], which a search settled, from every playlist that held it. */
  readonly drop: (song: UnsearchedSong) => void;
  /** The playlists with what's left of their songs. */
  readonly playlists: () => readonly FillPlaylist[];
}

/**
 * `indexFillPlaylists` one song a step (#1453): the app indexes a read of thousands of songs in
 * background slices, and Wave's startup holds the thread for none of it.
 */
export function* indexFillPlaylistsSteps(
  playlists: readonly FillPlaylist[],
): Generator<void, FillPlaylistsIndex> {
  type Entry = {
    readonly original: Omit<FillPlaylist, "songs">;
    readonly songs: Map<number, UnsearchedSong>;
    current: FillPlaylist | null;
  };
  const byKey = new Map<string, { entry: Entry; position: number }[]>();
  let remaining = 0;
  const entries: Entry[] = [];
  for (const playlist of playlists) {
    const entry: Entry = {
      original: { id: playlist.id, usedAt: playlist.usedAt },
      songs: new Map(),
      current: playlist,
    };
    entries.push(entry);
    for (const [position, song] of playlist.songs.entries()) {
      yield;
      entry.songs.set(position, song);
      const key = unsearchedTrackId(song);
      let occurrences = byKey.get(key);
      if (occurrences === undefined) byKey.set(key, (occurrences = []));
      occurrences.push({ entry, position });
      remaining++;
    }
  }
  const playlistIds = new Set(playlists.map((playlist) => playlist.id));
  return {
    has: (id: number): boolean => playlistIds.has(id),
    empty: (): boolean => remaining === 0,
    drop: (song: UnsearchedSong): void => {
      const key = unsearchedTrackId(song);
      for (const { entry, position } of byKey.get(key) ?? []) {
        entry.songs.delete(position);
        entry.current = null;
        remaining--;
      }
      byKey.delete(key);
    },
    playlists: (): readonly FillPlaylist[] =>
      entries.map(
        (entry) => (entry.current ??= { ...entry.original, songs: [...entry.songs.values()] }),
      ),
  };
}

/** `indexFillPlaylistsSteps` at once, for a read small enough or a caller with no slices. */
export const indexFillPlaylists = (playlists: readonly FillPlaylist[]): FillPlaylistsIndex =>
  finishSteps(indexFillPlaylistsSteps(playlists));
