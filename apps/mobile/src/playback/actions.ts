import {
  discoverTrackId,
  type MixedSong,
  nextRepeatMode,
  pagePlayback,
  type PagePlayback,
  type PlayableSongs,
  playlistPlayback,
  skipMissingSongs,
  tappedMissingSong,
  type UpNextMove,
  startSleepTimer,
  type QueueCommand,
  type QueueContext,
  type RepeatMode,
  type SleepTimerChoice,
  type YtSong,
  ytTrackId,
} from "@wave/core";
import * as Effect from "effect/Effect";

import { songHasFile, type PlayableSongRow, type SongRow } from "@/library/LibraryStore";
import { appRuntime } from "@/library/runtime";
import { ytMusicEnabled } from "@/settings/ytMusic";
import { downloadMissingSongs } from "@/ytmusic/YtDownloads";
import type { YtMusic } from "@/ytmusic/YtMusic";

import { Player, playbackState } from "./Player";
import { Queue, currentPositionMs, queueState, toQueueTrack } from "./Queue";
import { toYtQueueTrack, type QueueTrack } from "./queueTracks";
import { cacheYtCoversInBackground, ytQueueTrack } from "./ytQueueTracks";

/**
 * Runs [effect] and reports a failure. The promise settles once it has run
 * either way and never rejects, so callers that don't wait can drop it.
 */
const run = (effect: Effect.Effect<void, unknown, Player | Queue | YtMusic>): Promise<void> =>
  appRuntime.runPromise(effect).catch((error: unknown) =>
    playbackState.update((state) => ({
      ...state,
      error: error instanceof Error ? error.message : String(error),
    })),
  );

/** Applies [command] to the queue (see `run`), adding [songs] to the tracks it knows. */
const dispatch = (command: QueueCommand, songs: readonly PlayableSongRow[] = []): Promise<void> =>
  run(
    Effect.gen(function* () {
      const queue = yield* Queue;
      yield* queue.dispatch(command, songs.map(toQueueTrack));
    }),
  );

/** Starts the player's event sync and picks up a queue that is already playing. */
export const connectPlayer = (): Promise<void> => run(Effect.asVoid(Queue));

/** A song of a list that mixes the Library's songs and YT Music's. */
type ListedSong = MixedSong<YtSong, SongRow>;

/** A listed song that can play: a YT Music song, or a Library song with a file. */
type PlayableListedSong = MixedSong<YtSong, PlayableSongRow>;

const playable = (song: ListedSong): song is PlayableListedSong =>
  song.source === "stream" || songHasFile(song.track);

/** The Library song a listed song is, if it is one. */
const libraryTrack = (song: ListedSong): SongRow | null =>
  song.source === "library" ? song.track : null;

/**
 * What a tap, Play or Shuffle on [songs] plays: the songs [hasFile] says can play, from the
 * tapped one at [startIndex] (Core's `skipMissingSongs`); null when nothing plays. A tapped
 * missing song ([track]: the Library song it is) downloads instead (Core's `tappedMissingSong`).
 */
const leaveOutMissing = <T, P extends T>(
  songs: readonly T[],
  startIndex: number | undefined,
  hasFile: (song: T) => song is P,
  track: (song: T) => SongRow | null,
): PlayableSongs<P> | null => {
  const tapped = tappedMissingSong(songs, startIndex, hasFile);
  const missing = tapped === null ? null : track(tapped);
  if (missing !== null) downloadMissingSongs([missing.id]);
  return skipMissingSongs(songs, startIndex, hasFile);
};

/** The Library songs of a mixed list as the queue takes them. */
const libraryQueueTracks = (songs: readonly PlayableListedSong[]): QueueTrack[] =>
  songs.flatMap((song) => (song.source === "library" ? [toQueueTrack(song.track)] : []));

/** [songs] with the one playing now (a shuffled play's pick) first, so its cover is cached first. */
const nowPlayingFirst = (songs: readonly YtSong[]): YtSong[] => {
  const { entries, index } = queueState.get();
  const current = entries[index]?.trackId;
  const playing = songs.filter((song) => ytTrackId(song.videoId) === current);
  return [...playing, ...songs.filter((song) => !playing.includes(song))];
};

/**
 * Applies [command] to the queue, adding [tracks] and YT Music [songs]. Only
 * [first]'s cover (the song that starts playing) is waited for, briefly (see
 * `ytQueueTrack`); the others' are cached afterwards, in the background.
 */
const dispatchWithYt = (
  command: QueueCommand,
  songs: readonly YtSong[],
  first: YtSong | undefined,
  tracks: readonly QueueTrack[] = [],
): Promise<void> =>
  run(
    Effect.gen(function* () {
      const firstTrack = first === undefined ? [] : [yield* ytQueueTrack(first)];
      const rest = songs.filter((song) => song !== first);
      const queue = yield* Queue;
      yield* queue.dispatch(command, [
        ...tracks,
        ...firstTrack,
        ...rest.map((song) => toYtQueueTrack(song, null)),
      ]);
      yield* cacheYtCoversInBackground(nowPlayingFirst(rest));
    }),
  );

const ytTrackIds = (songs: readonly YtSong[]): string[] =>
  songs.map((song) => ytTrackId(song.videoId));

type PlayOptions = { readonly shuffle?: boolean };

/** Plays Library songs that all have a file, from [startIndex] (or shuffled). */
const startSongs = (
  { songs, startIndex }: PlayableSongs<PlayableSongRow>,
  context: QueueContext,
  options: PlayOptions,
): Promise<void> =>
  dispatch(
    {
      type: "play",
      trackIds: songs.map((song) => String(song.id)),
      startIndex,
      context,
      shuffle: options.shuffle,
    },
    songs,
  );

/** Plays a mixed list that can all play: the Library's files, the others streamed. */
const startMixed = (
  { songs, startIndex }: PlayableSongs<PlayableListedSong>,
  context: QueueContext,
  options: PlayOptions,
): Promise<void> => {
  const start = startIndex === undefined ? undefined : songs[startIndex];
  return dispatchWithYt(
    {
      type: "play",
      trackIds: songs.map(discoverTrackId),
      startIndex,
      context,
      shuffle: options.shuffle,
    },
    songs.flatMap((song) => (song.source === "library" ? [] : [song.song])),
    start?.source === "library" ? undefined : start?.song,
    libraryQueueTracks(songs),
  );
};

/** Plays what Core's `pagePlayback` or `playlistPlayback` decided, from [startIndex]. */
const startPlayback = (
  playback: PagePlayback<YtSong, PlayableSongRow>,
  startIndex: number | undefined,
  context: QueueContext,
  options: PlayOptions,
): Promise<void> =>
  playback.kind === "mixed"
    ? startMixed({ songs: playback.songs, startIndex }, context, options)
    : startSongs({ songs: playback.tracks, startIndex }, context, options);

/**
 * Plays a list (an album, the Songs list…) from `startIndex`, queueing the rest
 * of it. Omit `startIndex` to start at the top, or anywhere with `shuffle`.
 * Missing songs (no file on this phone) are left out (Core's
 * `skipMissingSongs`): a tapped one downloads instead.
 */
export const playSongs = async (
  songs: readonly SongRow[],
  startIndex: number | undefined,
  context: QueueContext,
  options: PlayOptions = {},
): Promise<void> => {
  const play = leaveOutMissing(songs, startIndex, songHasFile, (song) => song);
  if (play !== null) await startSongs(play, context, options);
};

/**
 * Plays YT Music songs (the ones Search found) from `startIndex`, queueing the
 * rest after it, streamed as each one's turn comes.
 */
export const playYtSongs = (
  songs: readonly YtSong[],
  startIndex: number,
  context: QueueContext,
): Promise<void> =>
  dispatchWithYt(
    { type: "play", trackIds: ytTrackIds(songs), startIndex, context },
    songs,
    songs[startIndex],
  );

/**
 * Leaves the missing songs out of [listed] (a tapped one downloads instead),
 * then hands what can play to [start]; nothing when nothing can. Left out
 * first, so a tapped song's place is its place among what plays.
 */
const playListed = async (
  listed: readonly ListedSong[],
  listedStart: number | undefined,
  start: (play: PlayableSongs<PlayableListedSong>) => Promise<void>,
): Promise<void> => {
  const play = leaveOutMissing(listed, listedStart, playable, libraryTrack);
  if (play !== null) await start(play);
};

/**
 * Plays a list that mixes the Library's songs and YT Music's (Discover,
 * Search, an artist's or album's page) from `startIndex` (or shuffled),
 * queueing the rest: the Library's files, the others streamed. Missing songs
 * are left out, and a tapped one downloads instead.
 */
export const playDiscoverSongs = (
  listed: readonly ListedSong[],
  listedStart: number | undefined,
  context: QueueContext,
  options: PlayOptions = {},
): Promise<void> => playListed(listed, listedStart, (play) => startMixed(play, context, options));

/**
 * Plays a page's songs (Search's song results, an artist's or album's page)
 * from `startIndex` (or shuffled), by Core's `pagePlayback`: in an integrated
 * view, with YouTube Music's songs among them, the mixed list (the Library's
 * files, the rest streamed); otherwise the Library's songs alone, so nothing
 * streams outside one. Missing songs are left out, and a tapped one downloads instead.
 */
export const playPage = (
  listed: readonly ListedSong[],
  listedStart: number | undefined,
  context: QueueContext,
  options: PlayOptions = {},
): Promise<void> =>
  playListed(listed, listedStart, (play) =>
    startPlayback(pagePlayback(play.songs), play.startIndex, context, options),
  );

/**
 * Plays a playlist's [entries] from `startIndex` (or shuffled), by Core's
 * `playlistPlayback`: with YT Music on and YT Music entries among them, the
 * whole list (the Library's files, the rest streamed); with it off, the
 * Library's songs alone. Missing songs never play: a tapped one downloads
 * instead. Resolves false when
 * there's nothing to play because YT Music is off (a YT Music entry tapped).
 */
export const playPlaylist = async (
  entries: readonly ListedSong[],
  listedStart: number | undefined,
  context: QueueContext,
  options: PlayOptions = {},
): Promise<boolean> => {
  const files = leaveOutMissing(entries, listedStart, playable, libraryTrack);
  // A missing song tapped, or nothing but missing songs: YT Music isn't why.
  if (files === null) return true;
  const play = playlistPlayback(files.songs, {
    ytMusic: ytMusicEnabled(),
    startIndex: files.startIndex,
  });
  if (play === null) return false;
  await startPlayback(play.playback, play.startIndex, context, options);
  return true;
};

export const playYtNext = (songs: readonly YtSong[]): Promise<void> =>
  dispatchWithYt({ type: "playNext", trackIds: ytTrackIds(songs) }, songs, undefined);

export const addYtToQueue = (songs: readonly YtSong[]): Promise<void> =>
  dispatchWithYt({ type: "addToQueue", trackIds: ytTrackIds(songs) }, songs, undefined);

/**
 * Plays Discover's [songs] next, or adds them to the end of the queue: the
 * Library's file for the songs it has, the others streamed. Missing songs
 * are left out.
 */
export const queueDiscoverSongs = (
  listed: readonly MixedSong<YtSong, SongRow>[],
  where: "playNext" | "addToQueue",
): Promise<void> => {
  const songs = listed.filter(playable);
  return dispatchWithYt(
    { type: where, trackIds: songs.map(discoverTrackId) },
    songs.flatMap((song) => (song.source === "library" ? [] : [song.song])),
    undefined,
    libraryQueueTracks(songs),
  );
};

export const togglePlayPause = (): Promise<void> =>
  run(
    Effect.gen(function* () {
      const player = yield* Player;
      yield* playbackState.get().playWhenReady ? player.pause : player.play;
    }),
  );

export const skipToNext = (): Promise<void> => dispatch({ type: "next" });

/** Restarts the track after 3 seconds, otherwise goes to the previous one. */
export const skipToPrevious = (): Promise<void> =>
  dispatch({ type: "previous", positionMs: currentPositionMs() });

/** Queues [songs] as [type] says; missing songs (no file) are left out. */
const queueSongs = (type: "playNext" | "addToQueue", songs: readonly SongRow[]): Promise<void> => {
  const tracks = songs.filter(songHasFile);
  return tracks.length === 0
    ? Promise.resolve()
    : dispatch({ type, trackIds: tracks.map((song) => String(song.id)) }, tracks);
};

export const playNext = (songs: readonly SongRow[]): Promise<void> => queueSongs("playNext", songs);

export const addToQueue = (songs: readonly SongRow[]): Promise<void> =>
  queueSongs("addToQueue", songs);

export const setShuffle = (on: boolean): Promise<void> => dispatch({ type: "setShuffle", on });

export const toggleShuffle = (): Promise<void> => setShuffle(!queueState.get().shuffle);

export const setRepeat = (mode: RepeatMode): Promise<void> => dispatch({ type: "setRepeat", mode });

/** Off → all → one → off, like Apple Music's repeat button. */
export const cycleRepeat = (): Promise<void> => setRepeat(nextRepeatMode(queueState.get().repeat));

/** Plays an Up Next entry. */
export const playQueueEntry = (key: string): Promise<void> => dispatch({ type: "jumpTo", key });

/**
 * Moves an Up Next entry (Core's `upNextMove`). The promise settles once the
 * queue has the move (or it failed), which may wait on earlier commands and
 * the native player.
 */
export const moveQueueEntry = (move: UpNextMove): Promise<void> =>
  dispatch({ type: "move", ...move });

export const removeQueueEntry = (key: string): Promise<void> => dispatch({ type: "remove", key });

/**
 * Seeks the current track. The position shows at once, before the player
 * confirms it, so the scrubber doesn't jump back and "previous" sees it.
 */
export const seekTo = (positionMs: number): void => {
  playbackState.update((state) => ({ ...state, positionMs, at: Date.now() }));
  void run(
    Effect.gen(function* () {
      const player = yield* Player;
      yield* player.seekTo(positionMs);
    }),
  );
};

/**
 * Starts the sleep timer, replacing a running one. The playback service
 * enforces it, and `sleepTimerState` follows it from there.
 */
export const setSleepTimer = (choice: SleepTimerChoice): void => {
  const timer = startSleepTimer(choice, Date.now());
  if (timer === null) return;
  void run(
    Effect.gen(function* () {
      const player = yield* Player;
      yield* player.setSleepTimer(timer);
    }),
  );
};

export const cancelSleepTimer = (): Promise<void> =>
  run(
    Effect.gen(function* () {
      const player = yield* Player;
      yield* player.setSleepTimer(null);
    }),
  );
