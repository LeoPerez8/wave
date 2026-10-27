import {
  queueSongTrackId,
  type MixedSong,
  nextRepeatMode,
  pagePlayback,
  type PagePlayback,
  type PlayableSongs,
  type PlaylistItem,
  playlistPlayback,
  playlistUnplayableNotice,
  skipMissingSongs,
  tappedMissingSong,
  type UpNextMove,
  startSleepTimer,
  type QueueCommand,
  type QueueContext,
  type QueueSong,
  type RepeatMode,
  type SeekSource,
  type ShuffleKind,
  type SleepTimerChoice,
  type YtSong,
  ytTrackId,
} from "@wave/core";
import * as Effect from "effect/Effect";

import {
  LibraryStore,
  songHasFile,
  type PlayableSongRow,
  type SongRow,
} from "@/library/LibraryStore";
import { appRuntime } from "@/library/runtime";
import { setShuffleKind } from "@/settings/shuffleKind";
import { ytMusicEnabled } from "@/settings/ytMusic";
import { downloadMissingSongs } from "@/ytmusic/YtDownloads";
import type { YtMusic } from "@/ytmusic/YtMusic";

import { Player, playbackState, positionState } from "./Player";
import { Queue, currentPositionMs, queueState, toQueueTrack } from "./Queue";
import { toUnsearchedQueueTrack, toYtQueueTrack, type QueueTrack } from "./queueTracks";
import { cacheYtCoversInBackground, ytQueueTrack } from "./ytQueueTracks";

/** Shows a playback action's failure. */
const reportError = (error: unknown): void =>
  playbackState.update((state) => ({
    ...state,
    error: error instanceof Error ? error.message : String(error),
  }));

/**
 * Runs [effect] and reports a failure. The promise settles once it has run
 * either way and never rejects, so callers that don't wait can drop it.
 */
const run = (effect: Effect.Effect<void, unknown, Player | Queue | YtMusic>): Promise<void> =>
  appRuntime.runPromise(effect).catch(reportError);

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

/** A song that queues: a Library song, a YT Music song, or a playlist's unsearched song. */
type QueuedSong = QueueSong<YtSong, SongRow>;

/** A song that can play: a YT Music or unsearched song, or a Library song with a file. */
type PlayableListedSong = QueueSong<YtSong, PlayableSongRow>;

const playable = (song: QueuedSong): song is PlayableListedSong =>
  song.source !== "library" || songHasFile(song.track);

/** The Library song a listed song is, if it is one. */
const libraryTrack = (song: QueuedSong): SongRow | null =>
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

/**
 * The songs of a mixed list that aren't YT Music songs as the queue takes
 * them: the Library's, and the unsearched ones (searched as they're about to
 * play).
 */
const libraryQueueTracks = (songs: readonly PlayableListedSong[]): QueueTrack[] =>
  songs.flatMap((song) =>
    song.source === "library"
      ? [toQueueTrack(song.track)]
      : song.source === "unsearched"
        ? [toUnsearchedQueueTrack(song.song)]
        : [],
  );

/** The YT Music songs of a mixed list. */
const streamedSongs = (songs: readonly PlayableListedSong[]): YtSong[] =>
  songs.flatMap((song) => (song.source === "stream" ? [song.song] : []));

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
      // The first song's cover, if it didn't cache in time, is cached with the others.
      const firstUncached =
        first !== undefined && first.artworkUrl !== null && firstTrack[0]?.thumbPath === null
          ? [first]
          : [];
      yield* cacheYtCoversInBackground([...firstUncached, ...nowPlayingFirst(rest)]);
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
      trackIds: songs.map(queueSongTrackId),
      startIndex,
      context,
      shuffle: options.shuffle,
    },
    streamedSongs(songs),
    start?.source === "stream" ? start.song : undefined,
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
 * Plays a list known by its Track ids (the paged Songs list), as `playSongs`
 * plays rows: from `startIndex` (or the top, or shuffled), leaving out the
 * [missing] songs, a tapped one downloading instead. Only now are the rows the
 * queue needs read, for every song that plays, loaded on screen or not. Songs
 * gone since the ids were read are left out; a tapped one that's gone plays nothing.
 */
export const playTrackIds = async (
  ids: readonly number[],
  missing: ReadonlySet<number>,
  startIndex: number | undefined,
  context: QueueContext,
  options: PlayOptions = {},
): Promise<void> => {
  const hasFile = (id: number): boolean => !missing.has(id);
  const tapped = tappedMissingSong(ids, startIndex, hasFile);
  if (tapped !== null) downloadMissingSongs([tapped]);
  if (skipMissingSongs(ids, startIndex, hasFile) === null) return;
  const songs = await appRuntime
    // oxlint-disable-next-line react/rules-of-hooks -- Effect Service.use resolves a service; it is not a React Hook.
    .runPromise(LibraryStore.use((store) => store.songsByIds(ids.filter(hasFile))))
    .catch((error: unknown) => {
      reportError(error);
      return null;
    });
  if (songs === null) return;
  const byId = new Map(songs.map((song) => [song.id, song]));
  const play = skipMissingSongs(ids, startIndex, (id) => byId.has(id));
  if (play === null) return;
  await startSongs(
    { songs: play.songs.map((id) => byId.get(id)!), startIndex: play.startIndex },
    context,
    options,
  );
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
 * Plays a list that mixes the Library's songs and YT Music's (a Discover
 * mix, Search, an artist's or album's page) from `startIndex` (or shuffled),
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

/** A playlist's entry: a listed song, or an unavailable song (Core's `PlaylistItem`). */
type PlaylistListed = PlaylistItem<YtSong, SongRow>;

/** A playlist's entry that isn't a missing song: Core's `playlistPlayback` skips the unavailable ones. */
const notMissing = (
  entry: PlaylistListed,
): entry is PlayableListedSong | Extract<PlaylistListed, { source: "unavailable" }> =>
  entry.source === "unavailable" || playable(entry);

/**
 * Plays a playlist's [entries] (or a ranking: Stats' songs, Home's Most played)
 * from `startIndex` (or shuffled), by Core's
 * `playlistPlayback`: with YT Music on and YT Music entries among them, the
 * whole list (the Library's files, the rest streamed); with it off, the
 * Library's songs alone. Unavailable entries never play (a tapped one is the
 * caller's to explain). Missing songs never play: a tapped one downloads
 * instead. Resolves to what to say when nothing plays: why, when every entry
 * but the missing songs is unavailable (Core's `playlistUnplayableNotice`),
 * or that YT Music is off (a YT Music entry tapped, or nothing else to play);
 * null otherwise.
 */
export const playPlaylist = async (
  entries: readonly PlaylistListed[],
  listedStart: number | undefined,
  context: QueueContext,
  options: PlayOptions = {},
): Promise<string | null> => {
  const files = leaveOutMissing(entries, listedStart, notMissing, (entry) =>
    entry.source === "library" ? entry.track : null,
  );
  // A missing song tapped (it downloads), or nothing but missing songs.
  if (files === null) return null;
  const unplayable = playlistUnplayableNotice(files.songs);
  if (unplayable !== null) return unplayable;
  const play = playlistPlayback(files.songs, {
    ytMusic: ytMusicEnabled(),
    startIndex: files.startIndex,
  });
  if (play === null) return "YT Music is off in Settings";
  await startPlayback(play.playback, play.startIndex, context, options);
  return null;
};

export const playYtNext = (songs: readonly YtSong[]): Promise<void> =>
  dispatchWithYt({ type: "playNext", trackIds: ytTrackIds(songs) }, songs, undefined);

export const addYtToQueue = (songs: readonly YtSong[]): Promise<void> =>
  dispatchWithYt({ type: "addToQueue", trackIds: ytTrackIds(songs) }, songs, undefined);

/**
 * Plays a mixed list's [songs] next, or adds them to the end of the queue: the
 * Library's file for the songs it has, the others streamed. Missing songs
 * are left out.
 */
export const queueDiscoverSongs = (
  listed: readonly QueuedSong[],
  where: "playNext" | "addToQueue",
): Promise<void> => {
  const songs = listed.filter(playable);
  return dispatchWithYt(
    { type: where, trackIds: songs.map(queueSongTrackId) },
    streamedSongs(songs),
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

/**
 * A kind of shuffle picked on the shuffle card: saved for every shuffle from
 * now on, and shuffle turns on with Up Next shuffled that way.
 */
export const chooseShuffleKind = (kind: ShuffleKind): Promise<void> => {
  setShuffleKind(kind);
  return dispatch({ type: "reshuffle" });
};

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
 * [source] names the seek in the app log's crossfade lines.
 */
export const seekTo = (positionMs: number, source: SeekSource): void => {
  positionState.update((state) => ({ ...state, positionMs, at: Date.now() }));
  void run(
    Effect.gen(function* () {
      const player = yield* Player;
      yield* player.seekTo(positionMs, source);
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
