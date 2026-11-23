import { currentLocalisation, useLocalisation } from "@/localisation/localisation";
import {
  GENRE_FAITHFULNESS_STEPS,
  MAGIC_QUEUE_CONTEXT,
  genreProfile,
  isMagicQueue,
  magicBatchEmpty,
  magicBatchFailed,
  magicBatchLine,
  magicBatchLoading,
  magicPickDue,
  magicPickEnded,
  magicQueueDislikedEntries,
  magicBatchRadios,
  magicDjFirstSong,
  djFirstLibrarySong,
  djLibraryCandidates,
  magicLibrarySongs,
  magicListSeedSongs,
  completeMagicRadioBatch,
  completeMagicRadioBatchSteps,
  filterSteps,
  djSessionWithAlbumSongs,
  continueMagicQueue,
  queueContinuation,
  queueLengthsToRead,
  type QueueTimeAhead,
  magicYtSong,
  magicPlaySignal,
  magicQueueEdits,
  magicQueueFootnote,
  magicQueueLabel,
  magicQueueKeepsPlayingSong,
  magicQueueShare,
  magicSessionSliders,
  magicSignal,
  parseMagicSession,
  sliderStepLabel,
  startDjQueue as startDjSession,
  startMagicQueue as startSession,
  startStreamedMagicQueue as startStreamedSession,
  wantsMagicBatch,
  type DjSettings,
  type DjTile,
  type MagicBatchOutcome,
  type MagicSeed,
  type MagicSeedSong,
  type MagicSession,
  type MagicSignalKind,
  type QueueState,
  type YtSong,
  ytAlbumSongs,
  ytTrackId,
} from "@wave/core";
import * as Effect from "effect/Effect";
import * as Cause from "effect/Cause";
import * as Layer from "effect/Layer";
import { Storage } from "expo-sqlite/kv-store";
import { useSyncExternalStore } from "react";

import { magicProfileOf, magicProfileOfSteps } from "@/home/artistGenres";
import { recommendationSnapshot } from "@/home/recommendationSnapshot";
import { discoverLevel, discoverSliders } from "@/lib/discoverSettings";
import { makeExternalStore, subscribeAll } from "@wave/client/externalStore";
import { oneAtATime } from "@/lib/oneAtATime";
import { freeTurnEffect } from "@/lib/backgroundWork";
import { type BackgroundWorkName, namedWork, runSteps } from "@/lib/stepped";
import { dislikedSongsNow, onDislikesChanged } from "@/library/dislikes";
import { onStarred, onYtSongSignal } from "@/library/libraryChanges";
import { LibraryStore } from "@/library/LibraryStore";
import { songHasFile, type SongRow, type ArtistRow } from "@wave/client";
import { readDjAlbumSongs } from "@/dj/djAlbums";
import { djBatchReadMayResume, djStartWhileOpen } from "@/dj/djDone";
import { readYtAlbum } from "@/ytmusic/albumPages";
import { YtMusic } from "@/ytmusic/YtMusic";
import { appLog } from "@/log/appLog";
import { currentStreamBufferMs, subscribeStreamBuffer } from "@/settings/streamBuffer";
import { continueQueueOn, onContinueQueue } from "@/settings/continueQueue";
import { ytMusicEnabled, subscribeYtMusicEnabled } from "@/settings/ytMusic";
import { subscribeConnectivity } from "@/native/waveNative";

import {
  magicQueueDjLibraryRanking,
  magicQueueFirstRadioSong,
  magicQueueYtCandidates,
} from "./magicQueueRadio";
import { MAGIC_RADIO_DEADLINE_MS } from "./songRadioSession";
import { magicSignalsOf } from "./magicSongs";
import { Player, playbackState, sleepTimerState, sleepTimerLoaded } from "./Player";
import { onPlayEnded } from "./PlayHistory";
import { Queue, queueState, toQueueTrack, type QueueTrack } from "./Queue";
import { queueTracks, toYtQueueTrack } from "./queueTracks";
import { fillingPlay } from "./fillingPlay";
import { readQueueContinuationSeed } from "./queueContinuationSeed";
import { savedDiscoverMixForContinuation } from "../home/discoverMixes";
import { makeQueueLengths } from "./queueLengths";
import { latestTasteProfile, tasteProfileForRecommendation } from "./TasteProfile";
import { cacheYtCoversInBackground, ytQueueTrack } from "./ytQueueTracks";

/**
 * The Magic Queue (docs/spec.md, Magic Queue): Core's engine picks the songs
 * and learns; this module starts a session from a long-press menu, feeds it
 * what happens (plays ending, stars, downloads, dislikes, Up Next edits) and adds a
 * batch once the last recommendation plays, out of the Library and the
 * candidate catalog (`magicQueueRadio`), after every signal so far
 * was learned. The session is saved beside the queue, so it goes on after
 * Wave restarts, while the queue is still its own.
 */

const KEY = "playback.magicQueue";
let startingLibrary: {
  readonly songs: readonly SongRow[];
  readonly artists: readonly ArtistRow[];
} = { songs: [], artists: [] };

const readSaved = (): MagicSession | null => {
  try {
    const stored = Storage.getItemSync(KEY);
    return stored === null ? null : parseMagicSession(JSON.parse(stored));
  } catch {
    return null;
  }
};

/**
 * The latest Magic Queue session, kept after something else plays so Undo
 * on "New queue playing" can go back to it; it's only under way while the
 * queue is its own (`activeMagicSession`).
 */
const magicSession = makeExternalStore<MagicSession | null>(readSaved());

const save = (session: MagicSession): void => {
  magicSession.set(session);
  try {
    Storage.setItemSync(KEY, JSON.stringify(session));
  } catch {
    // Saving is best effort: the session goes on in memory.
  }
};

/** The Magic Queue session [state] is, if it's one. */
const activeMagicSession = (state: QueueState = queueState.get()): MagicSession | null => {
  const session = magicSession.get();
  return session !== null && isMagicQueue(session, state) ? session : null;
};

const labelNow = (): string | null => {
  const session = activeMagicSession();
  return session === null ? null : magicQueueLabel(session, currentLocalisation().strings);
};

const subscribeLabel = subscribeAll(queueState, magicSession);

/**
 * "Magic Queue · from <seed>" while the queue is a Magic Queue ("Related ·
 * from <song>" over one a Search tap or a song link began), else null;
 * re-renders on change.
 */
export const useMagicQueueLabel = (): string | null => {
  useLocalisation();
  return useSyncExternalStore(subscribeLabel, labelNow);
};

/**
 * The id of the session a batch is being picked for, from the moment it's
 * wanted until it's added, fails, times out or turns out not to be wanted;
 * null while none is.
 */
const picking = makeExternalStore<MagicSession["id"] | null>(null);
const failedBatch = makeExternalStore<MagicSession["id"] | null>(null);
/** The id of the session whose last pick found no songs (`magicBatchEmpty`, `magicPickDue`); null while none has. */
const emptyBatch = makeExternalStore<MagicSession["id"] | null>(null);
const retryBatch = makeExternalStore(0);

/** Try Again only asks the active Magic Queue for its missing batch, after a failed or an empty pick. */
export const retryMagicBatch = (): void => {
  emptyBatch.set(null);
  retryBatch.update((attempt) => attempt + 1);
};

const batchFailedNow = (): boolean =>
  magicBatchFailed(
    activeMagicSession(),
    failedBatch.get(),
    queueState.get(),
    sleepTimerState.get(),
  );
const subscribeBatchFailed = subscribeAll(queueState, magicSession, failedBatch, sleepTimerState);

export const useMagicBatchFailed = (): boolean =>
  useSyncExternalStore(subscribeBatchFailed, batchFailedNow);

const emptySeedNow = (): string | null => {
  const session = activeMagicSession();
  return magicBatchEmpty(session, emptyBatch.get(), queueState.get(), sleepTimerState.get())
    ? (session?.seed.title ?? null)
    : null;
};
const subscribeBatchEmpty = subscribeAll(queueState, magicSession, emptyBatch, sleepTimerState);

/**
 * The seed's title while Up Next says the Magic Queue under way found no
 * songs (`magicBatchEmpty`), else null. Re-renders on change.
 */
export const useMagicBatchEmptySeed = (): string | null =>
  useSyncExternalStore(subscribeBatchEmpty, emptySeedNow);

const batchLoadingNow = (): boolean =>
  magicBatchLoading(activeMagicSession(), picking.get(), queueState.get(), sleepTimerState.get());

const subscribeBatchLoading = subscribeAll(queueState, magicSession, picking, sleepTimerState);

/**
 * Whether the Magic Queue under way is picking its next batch, which Up Next
 * still waits for (`magicBatchLoading`): false once the batch lands, the
 * picking ends, or something else plays, and while an End of Queue sleep
 * timer holds the batch back. Re-renders on change.
 */
export const useMagicBatchLoading = (): boolean =>
  useSyncExternalStore(subscribeBatchLoading, batchLoadingNow);

const footnoteNow = (): boolean =>
  magicQueueFootnote(
    activeMagicSession(),
    { picking: picking.get(), failed: failedBatch.get(), empty: emptyBatch.get() },
    queueState.get(),
    sleepTimerState.get(),
  );
const subscribeFootnote = subscribeAll(
  queueState,
  magicSession,
  picking,
  failedBatch,
  emptyBatch,
  sleepTimerState,
);

/**
 * Whether the footnote sits under Up Next's last song: the Magic Queue under
 * way has its songs loaded and more can come (`magicQueueFootnote`). Hidden
 * while a batch loads, fails or finds nothing. Re-renders on change.
 */
export const useMagicQueueFootnote = (): boolean =>
  useSyncExternalStore(subscribeFootnote, footnoteNow);

/** When the current batch first became wanted, including starting the seed's queue. */
let batchStart: { readonly id: string; readonly at: number; readonly first: boolean } | null = null;

/** How many of the seed songs' video ids a session keeps: its song radio reads the first. */
const SEED_VIDEO_IDS = 5;

const queueLengths = makeQueueLengths();

/** Whether the player has started [state]'s current entry, including after restoration. */
const playingCurrentEntry = (state: QueueState): boolean => {
  const playback = playbackState.get();
  return (
    sleepTimerLoaded.get() &&
    playback.isPlaying &&
    playback.item?.id === state.entries[state.index]?.key
  );
};

/**
 * What tells how much of [state] is left to play, against the Buffer: the
 * lengths of the songs after the one playing.
 */
const timeAhead = (): QueueTimeAhead => {
  const tracks = queueTracks.get();
  return {
    bufferMs: currentStreamBufferMs(),
    durationMs: (trackId) => queueLengths.of(trackId, tracks),
  };
};

/** The seed [state] continues from now, if it is due to (Core's `queueContinuation`). */
const continuationSeedNow = (state: QueueState) =>
  playingCurrentEntry(state)
    ? queueContinuation(state, {
        enabled: continueQueueOn(),
        sleepTimer: sleepTimerState.get(),
        ahead: timeAhead(),
        filling: fillingPlay.get(),
      })
    : null;

/** How a session starts, beyond its seed (Core's `MagicSession`). */
export interface MagicStart {
  /** It keeps to its seed's genres, whatever Discover's sliders say. */
  readonly faithful?: boolean;
  /** A plain play of the song began it (a Search tap, a song link): Up Next says Related. */
  readonly plainPlay?: boolean;
}

/**
 * Starts a Magic Queue from [seed], whose songs are [seedSongs] (the song
 * itself for a song seed) and, for a playlist, its [streamedSongs]: it
 * replaces the queue (with Undo, as any play does) with the seed's first
 * Library song; the first 9 recommendations follow as the session's first
 * batch, at once when the radios it reads were saved, else once they were
 * read. Recommendations follow the song's radio for a song, the artist's for
 * an artist, and for an album or a playlist the radios of a few of its songs,
 * streamed ones included, drawn again each batch by their counted plays
 * (`magicBatchRadios`), streamed plays included; known genres only rank them.
 * YouTube Music's share of a batch starts at Discover's New music level
 * (`discoverLevel`), from Home or any long-press menu.
 */
export const startMagicQueue = (
  seed: MagicSeed,
  seedSongs: readonly SongRow[],
  streamedSongs: readonly YtSong[] = [],
  continuation?: QueueState,
  { faithful = false, plainPlay = false }: MagicStart = {},
) =>
  Effect.gen(function* () {
    if (continuation === undefined && !ytMusicEnabled()) return;
    const startedAt = Date.now();
    const playable = seedSongs.filter(songHasFile);
    // A list seed's songs are radio seeds, with or without a file.
    const list = seed.kind === "album" || seed.kind === "playlist" || seed.kind === "list";
    const radioSongs = list ? seedSongs : playable;
    const store = yield* LibraryStore;
    const artists = yield* store.artistsByIds([
      ...new Set(radioSongs.flatMap((song) => song.artistIds)),
    ]);
    // A seed whose artists YouTube Music doesn't know grows from its own song radio (`seedVideoIds`).
    const videoIds = yield* store
      .videoIds(radioSongs.map((song) => song.id))
      .pipe(Effect.orElseSucceed((): ReadonlyMap<number, string> => new Map()));
    const streamed = streamedSongs;
    const plays = list
      ? yield* store
          .songCountedPlays([
            ...seedSongs.map((song) => String(song.id)),
            ...streamed.map((song) => ytTrackId(song.videoId)),
          ])
          .pipe(Effect.orElseSucceed((): ReadonlyMap<string, number> => new Map()))
      : new Map<string, number>();
    const names = new Map(artists.map((artist) => [artist.id, artist.name]));
    const listSeedSongs = (): MagicSeedSong[] =>
      magicListSeedSongs(
        [
          ...seedSongs.map((song) => ({
            source: "library" as const,
            track: {
              id: song.id,
              title: song.title,
              artists: song.artistIds.flatMap((id) => names.get(id) ?? []),
              durationMs: song.durationMs,
              ...(videoIds.get(song.id) === undefined ? {} : { videoId: videoIds.get(song.id)! }),
            },
          })),
          ...streamed.map((song) => ({ source: "stream" as const, song })),
        ],
        plays,
      );
    const current =
      continuation === undefined ? undefined : continuation.entries[continuation.index];
    const currentTrack = current === undefined ? undefined : queueTracks.get().get(current.trackId);
    const candidates =
      currentTrack === undefined
        ? playable.map(magicLibrarySongs(artists))
        : [
            magicYtSong(
              { trackId: currentTrack.id, artists: currentTrack.artists ?? [currentTrack.artist] },
              () => null,
            ),
          ];
    const started = startSession(seed, candidates, {
      id: String(Date.now()),
      random: Math.random,
      radio: {
        artists: [
          ...playable.flatMap((song) => song.artistIds.flatMap((id) => names.get(id) ?? [])),
          ...streamed.flatMap((song) => song.artists),
        ],
        ...(list
          ? { songs: listSeedSongs() }
          : playable[0] === undefined
            ? streamed[0] === undefined
              ? {}
              : {
                  song: {
                    id: `song:${seed.id}`,
                    title: seed.title,
                    artists: streamed[0].artists,
                    durationMs: streamed[0].durationMs,
                    videoId: streamed[0].videoId,
                  },
                }
            : {
                song: {
                  id: seed.kind === "artist" ? `artist:${seed.id}` : `song:${seed.id}`,
                  title: seed.kind === "track" ? seed.title : playable[0].title,
                  artists:
                    seed.kind === "artist"
                      ? [seed.title]
                      : playable[0].artistIds.flatMap((id) => names.get(id) ?? []),
                  durationMs: playable[0].durationMs,
                  ...(videoIds.get(playable[0].id) === undefined
                    ? {}
                    : { videoId: videoIds.get(playable[0].id)! }),
                  ...(seed.kind === "artist" ? { kind: "artist" as const } : {}),
                },
              }),
        profile: genreProfile(playable),
        videoIds: [
          ...playable.flatMap((song) => videoIds.get(song.id) ?? []),
          ...streamed.map((song) => song.videoId),
        ].slice(0, SEED_VIDEO_IDS),
      },
      ytShare: magicQueueShare(discoverLevel.get()),
      faithful: faithful || continuation !== undefined,
      plainPlay,
    });
    if (started === null) return;
    if (continuation !== undefined) {
      // Reads can finish after a skip, Repeat, a timer or a new Play. None adopts a stale session.
      if (queueState.get() !== continuation || continuationSeedNow(continuation) === null) return;
      const session = continueMagicQueue(started.session, continuation);
      const queue = yield* Queue;
      yield* queue.dispatch({
        type: "continueMagicQueue",
        sessionId: session.id,
        from: continuation,
      });
      if (queueState.get().context?.id !== session.id) return;
      startingLibrary = { songs: playable, artists };
      batchStart = { id: session.id, at: startedAt, first: true };
      failedBatch.set(null);
      emptyBatch.set(null);
      save(session);
      return;
    }
    const first = playable.find((song) => String(song.id) === started.first);
    if (first === undefined) return;
    startingLibrary = { songs: playable, artists };
    yield* begin(started.session, startedAt, toQueueTrack(first));
  }).pipe(namedWork("Magic Queue start"));

/**
 * Starts a Magic Queue from a streamed YT Music [song] (its long-press menu
 * in Search, a YT Music list, a Discover mix or the queue): as a Library
 * song's does, it replaces the queue (with Undo) with the song, and the
 * first 9 recommendations follow from its radio, even when [libraryTrack]
 * supplies the audio (Core's
 * `startStreamedMagicQueue`).
 */
export const startStreamedMagicQueue = (
  song: YtSong,
  { faithful = false, plainPlay = false }: MagicStart = {},
  libraryTrack?: SongRow,
) =>
  Effect.gen(function* () {
    if (!ytMusicEnabled()) return;
    const startedAt = Date.now();
    const { session } = startStreamedSession(song, {
      id: String(Date.now()),
      ytShare: magicQueueShare(discoverLevel.get()),
      faithful,
      plainPlay,
      ...(libraryTrack?.path === null || libraryTrack === undefined
        ? {}
        : { firstTrackId: String(libraryTrack.id) }),
    });
    // Nothing of the Library was read for it: the first pick waits for the snapshot's.
    startingLibrary = { songs: [], artists: [] };
    const track =
      libraryTrack !== undefined && songHasFile(libraryTrack)
        ? toQueueTrack(libraryTrack)
        : yield* ytQueueTrack(song);
    yield* begin(session, startedAt, track);
    yield* cacheYtCoversInBackground(track.thumbPath === null ? [song] : []);
  }).pipe(namedWork("Magic Queue start"));

/**
 * Plays [session]'s first song, [track], as its queue, with the first batch
 * on its way from the first frame; the taste profile warms meanwhile.
 */
const begin = (session: MagicSession, startedAt: number, track: QueueTrack) =>
  Effect.gen(function* () {
    const store = yield* LibraryStore;
    // Warm future picks without joining their derivation to this first batch.
    yield* Effect.forkDetach(
      recommendationSnapshot.get.pipe(
        Effect.flatMap(({ library }) => tasteProfileForRecommendation(library)),
        Effect.provideService(LibraryStore, store),
        Effect.ignore,
      ),
    );
    batchStart = { id: session.id, at: startedAt, first: true };
    save(session);
    // The first batch is on its way as the seed starts: Up Next shows it loading from the first frame.
    picking.set(session.id);
    failedBatch.set(null);
    emptyBatch.set(null);
    const queue = yield* Queue;
    const state = queueState.get();
    const currentTrackId = state.entries[state.index]?.trackId ?? null;
    const currentTrack =
      currentTrackId === null ? undefined : queueTracks.get().get(currentTrackId);
    const seedRecording = session.radioSeed;
    const keepCurrent =
      session.seed.kind === "track" &&
      currentTrack !== undefined &&
      magicQueueKeepsPlayingSong(
        {
          trackId: session.seed.id,
          videoId: seedRecording?.videoId ?? track.ytSong?.videoId,
          // A session without a radio seed (no radio was read) is matched by its own track.
          recording:
            seedRecording === undefined
              ? {
                  title: track.title,
                  artists: track.ytSong?.artists ?? [track.artist],
                  durationMs: track.durationMs ?? 0,
                }
              : {
                  title: seedRecording.title,
                  artists: seedRecording.artists,
                  durationMs: seedRecording.durationMs ?? 0,
                },
        },
        {
          trackId: currentTrack.id,
          videoId: currentTrack.ytSong?.videoId,
          recording: {
            title: currentTrack.title,
            artists: currentTrack.ytSong?.artists ?? [currentTrack.artist],
            durationMs: currentTrack.durationMs ?? 0,
          },
        },
      );
    yield* queue.dispatch(
      {
        type: "play",
        trackIds: [track.id],
        startIndex: 0,
        context: { kind: MAGIC_QUEUE_CONTEXT, id: session.id },
        shuffle: false,
        ...(keepCurrent ? { keepCurrentAndReplaceUpNext: { trackId: currentTrack.id } } : {}),
      },
      [track],
    );
    if (session.seed.kind === "dj")
      appLog("info", "WaveTiming", `DJ first song: ${Date.now() - startedAt}ms`);
  });

/** A picked batch's songs as queue tracks, in its order: [library]'s files and the batch's own streams. */
const batchQueueTracks = (
  batch: ReturnType<typeof completeMagicRadioBatch>,
  library: readonly SongRow[],
): QueueTrack[] => {
  // Only the batch's own songs become tracks: the Library may hold thousands (#1448).
  const wanted = new Set(batch.trackIds);
  const tracks = new Map<string, QueueTrack>();
  for (const song of library)
    if (wanted.has(String(song.id)) && songHasFile(song))
      tracks.set(String(song.id), toQueueTrack(song));
  // The batch's own songs, so a stream that only the Close fill ranked has its track too.
  for (const candidate of batch.songs)
    if (candidate.source === "stream" && candidate.song !== null)
      tracks.set(candidate.trackId, toYtQueueTrack(candidate.song, null));
  return batch.trackIds.flatMap((id) => tracks.get(id) ?? []);
};

/** A picked batch's streamed songs, whose covers are cached once it's queued. */
const batchStreams = (batch: ReturnType<typeof completeMagicRadioBatch>): YtSong[] =>
  batch.songs.flatMap((candidate) =>
    candidate.source === "stream" && candidate.song !== null ? [candidate.song] : [],
  );

/**
 * How Done in DJ ended: the queue is playing, the seed's radios gave no song
 * to play, or none of them could be read.
 */
export type DjStart = "started" | "empty" | "failed";

/**
 * The songs of the albums among a DJ seed's [tiles], as seed songs with
 * their counted plays (`readDjAlbumSongs`): the Library album's, with or
 * without a file, else the songs of its YT Music page, read by
 * [deadlineAt] (epoch ms), the first batch's deadline its radios share.
 * Only the album's browse id is sent.
 */
const djAlbumSeedSongs = (tiles: readonly DjTile[], deadlineAt: number, libraryOnly = false) =>
  Effect.gen(function* () {
    const store = yield* LibraryStore;
    const playsOf = (trackIds: readonly string[]) =>
      store
        .songCountedPlays(trackIds)
        .pipe(Effect.orElseSucceed((): ReadonlyMap<string, number> => new Map()));
    const library = (albumId: number) =>
      Effect.gen(function* () {
        const songs = (yield* store.getAlbum(albumId))?.tracks ?? [];
        const artists = yield* store.artistsByIds([
          ...new Set(songs.flatMap((song) => song.artistIds)),
        ]);
        const names = new Map(artists.map((artist) => [artist.id, artist.name]));
        const videoIds = yield* store
          .videoIds(songs.map((song) => song.id))
          .pipe(Effect.orElseSucceed((): ReadonlyMap<number, string> => new Map()));
        return magicListSeedSongs(
          songs.map((song) => ({
            source: "library" as const,
            track: {
              id: song.id,
              title: song.title,
              artists: song.artistIds.flatMap((id) => names.get(id) ?? []),
              durationMs: song.durationMs,
              ...(videoIds.get(song.id) === undefined ? {} : { videoId: videoIds.get(song.id)! }),
            },
          })),
          yield* playsOf(songs.map((song) => String(song.id))),
        );
      });
    const page = (browseId: string) =>
      Effect.gen(function* () {
        const album = yield* Effect.tryPromise(() => readYtAlbum(browseId)).pipe(
          Effect.timeout(Math.max(0, deadlineAt - Date.now())),
        );
        const songs = ytAlbumSongs(browseId, album);
        return magicListSeedSongs(
          songs.map((song) => ({ source: "stream" as const, song })),
          yield* playsOf(songs.map((song) => ytTrackId(song.videoId))),
        );
      });
    return yield* Effect.promise(() =>
      readDjAlbumSongs(tiles, {
        library: (albumId) => Effect.runPromise(library(albumId).pipe(namedWork("DJ album songs"))),
        page: (browseId) =>
          libraryOnly
            ? Promise.resolve([])
            : Effect.runPromise(page(browseId).pipe(namedWork("DJ album songs"))),
      }),
    );
  });

/**
 * Starts a Magic Queue from a DJ seed, the selected [tiles] (Core's
 * `startDjQueue`). A playable Library song starts as soon as local album
 * seeds are read; otherwise the first answered radio starts it while the
 * other selected radios keep loading. The remaining nine songs join that
 * first song through the regular Magic Queue batch picker. It ranks with
 * [settings], DJ's own choices from Adjust, not Discover's sliders, and its
 * Artist variety limits each batch (`magicQueueYtCandidates`). Selected
 * album pages and radios share one deadline from the tap
 * (`MAGIC_RADIO_DEADLINE_MS`). The Library, catalog, graph and taste profile
 * are the last ones derived. Closing DJ before a first song starts cancels
 * the queue change.
 */
export const startDjMagicQueue = (
  tiles: readonly DjTile[],
  settings: DjSettings,
  closed?: AbortSignal,
) =>
  Effect.gen(function* () {
    if (!ytMusicEnabled()) return "failed" satisfies DjStart;
    const startedAt = Date.now();
    const deadlineAt = startedAt + MAGIC_RADIO_DEADLINE_MS;
    const latest = recommendationSnapshot.peek();
    const library = latest.library ?? { songs: [], artists: [] };
    // A playable Library match starts the DJ session before any album page or radio read.
    const localAlbumSongs = yield* djAlbumSeedSongs(tiles, deadlineAt, true);
    const localAlbumSession = startDjSession(tiles, {
      id: String(startedAt),
      played: latest.library?.topArtists ?? [],
      settings,
      albumSongs: localAlbumSongs,
    });
    if (localAlbumSession === null) return "empty" satisfies DjStart;
    const drawnLibrary = magicBatchRadios(localAlbumSession, Math.random);
    const artistNames = new Map(library.artists.map((artist) => [artist.id, artist.name]));
    const playableLibrary = library.songs
      .filter((song): song is SongRow & { readonly path: string } => song.path !== null)
      .map((song) => ({
        ...song,
        artistNames: song.artistIds.flatMap((id) => {
          const name = artistNames.get(id);
          return name === undefined ? [] : [name];
        }),
      }));
    const matchingLibrary = djLibraryCandidates(tiles, playableLibrary);
    const rankedLibrary = yield* magicQueueDjLibraryRanking(
      drawnLibrary.session,
      matchingLibrary,
      { songs: library.songs, artists: library.artists },
      {
        catalog: latest.catalog ?? [],
        graph: latest.graph,
        taste: latestTasteProfile(),
        profileOf: magicProfileOf(library),
        sliders: magicSessionSliders(drawnLibrary.session, discoverSliders.get()),
      },
    );
    // A mood's unknown songs only fill what its matched ones can't, so a known match leads.
    const initialLibraryBatch = completeMagicRadioBatch(
      drawnLibrary.session,
      rankedLibrary.matched,
      [],
      () => ({ seed: rankedLibrary.unknown, liked: [] }),
    );
    const initialLibraryOrder = new Map(
      initialLibraryBatch.trackIds.map((trackId, index) => [trackId, index] as const),
    );
    const firstLibrarySong = djFirstLibrarySong(
      tiles,
      matchingLibrary.filter((song) => initialLibraryOrder.has(String(song.id))),
      {
        excluded: dislikedSongsNow(),
        scoreOf: (song) => -(initialLibraryOrder.get(String(song.id)) ?? Number.POSITIVE_INFINITY),
      },
    );
    if (closed?.aborted) return "failed" satisfies DjStart;
    if (localAlbumSession !== null && firstLibrarySong !== null) {
      const session = {
        ...magicDjFirstSong(drawnLibrary.session, firstLibrarySong.artistNames),
        used: [String(firstLibrarySong.id)],
      };
      const needsAlbumPages = tiles.some(
        (tile) => tile.kind === "album" && tile.browseId !== null && !localAlbumSongs.has(tile.key),
      );
      startingLibrary = { songs: library.songs.filter(songHasFile), artists: library.artists };
      if (needsAlbumPages) pendingDjFirstBatch = session.id;
      const start = djStartWhileOpen(closed, () =>
        begin(
          session,
          startedAt,
          toQueueTrack({ ...firstLibrarySong, path: firstLibrarySong.path! }),
        ),
      );
      if (start === null) return "failed" satisfies DjStart;
      yield* start;
      if (needsAlbumPages)
        yield* Effect.forkDetach(
          djAlbumSeedSongs(tiles, deadlineAt).pipe(
            Effect.tap((albumSongs) =>
              Effect.sync(() => {
                const current = activeMagicSession();
                if (current?.id !== session.id) return;
                const refreshed = startDjSession(tiles, {
                  id: session.id,
                  played: latest.library?.topArtists ?? [],
                  settings,
                  albumSongs,
                });
                if (refreshed !== null) save(djSessionWithAlbumSongs(current, refreshed));
              }),
            ),
            Effect.catchCause(() => Effect.void),
            Effect.ensuring(Effect.sync(() => finishDjFirstBatch(session.id))),
          ),
        );
      return "started" satisfies DjStart;
    }
    const started = startDjSession(tiles, {
      id: String(startedAt),
      played: latest.library?.topArtists ?? [],
      settings,
      albumSongs: yield* djAlbumSeedSongs(tiles, deadlineAt),
    });
    if (started === null) return "empty" satisfies DjStart;
    const drawn = magicBatchRadios(started, Math.random);
    pendingDjFirstBatch = drawn.session.id;
    const firstRadioSong = yield* magicQueueFirstRadioSong(drawn.session, drawn.seeds, deadlineAt, {
      graph: latest.graph,
      profileOf: magicProfileOf(library),
      onSettled: () => finishDjFirstBatch(drawn.session.id),
    });
    if (firstRadioSong !== null) {
      const firstId = ytTrackId(firstRadioSong.videoId);
      startingLibrary = { songs: library.songs.filter(songHasFile), artists: library.artists };
      const start = djStartWhileOpen(closed, () =>
        begin(
          { ...magicDjFirstSong(drawn.session, firstRadioSong.artists), used: [firstId] },
          startedAt,
          toYtQueueTrack(firstRadioSong, null),
        ),
      );
      if (start === null) {
        finishDjFirstBatch(drawn.session.id);
        return "failed" satisfies DjStart;
      }
      yield* start;
      yield* cacheYtCoversInBackground([firstRadioSong]);
      return "started" satisfies DjStart;
    }
    pendingDjFirstBatch = null;
    const yt = yield* magicQueueYtCandidates(drawn.session, drawn.seeds, library, {
      catalog: latest.catalog ?? [],
      graph: latest.graph,
      taste: latestTasteProfile(),
      sliders: magicSessionSliders(drawn.session, discoverSliders.get()),
      profileOf: magicProfileOf(library),
      deadlineAt,
    });
    yield* freeTurnEffect;
    const batch = completeMagicRadioBatch(
      drawn.session,
      yt.candidates,
      yt.likedCandidates,
      yt.fallback,
    );
    yield* freeTurnEffect;
    const songs = batchQueueTracks(batch, library.songs);
    appLog(
      "info",
      "WaveTiming",
      magicBatchLine({
        first: true,
        ms: Date.now() - startedAt,
        outcome:
          songs.length > 0
            ? { kind: "appended", songs: songs.length }
            : { kind: "failed", reason: yt.refilled === null ? "no radio read" : "no songs" },
      }),
    );
    if (songs.length === 0) return (yt.refilled === null ? "failed" : "empty") satisfies DjStart;
    if (closed?.aborted) return "failed" satisfies DjStart;
    startingLibrary = { songs: library.songs.filter(songHasFile), artists: library.artists };
    save(batch.session);
    failedBatch.set(null);
    emptyBatch.set(null);
    const queue = yield* Queue;
    yield* queue.dispatch(
      {
        type: "play",
        trackIds: songs.map((song) => song.id),
        startIndex: 0,
        context: { kind: MAGIC_QUEUE_CONTEXT, id: batch.session.id },
        shuffle: false,
      },
      songs,
    );
    appLog("info", "WaveTiming", `DJ first song: ${Date.now() - startedAt}ms`);
    yield* cacheYtCoversInBackground(batchStreams(batch));
    return "started" satisfies DjStart;
  }).pipe(namedWork("DJ batch"));

/**
 * Runs [effect] on its own; the Magic Queue is best effort and never disturbs
 * playback. Its turns are logged as [name] unless the work names itself (#1437).
 */
const fork = (
  effect: Effect.Effect<void, unknown, BackgroundWorkName>,
  name = "Magic Queue",
): void => {
  Effect.runFork(Effect.ignore(effect).pipe(namedWork(name)));
};

/**
 * The signals that ask an empty pick again (`magicPickDue`): a play's end or a
 * skip just moves through the queue, which the same inputs would answer alike.
 */
const ASKS_AGAIN: ReadonlySet<MagicSignalKind> = new Set(["favorite", "download", "added"]);

/**
 * Bumped by each ask for a batch again (a signal of `ASKS_AGAIN`, a slider
 * move): an empty pick under way meanwhile doesn't mark its session, it picks again.
 */
let asked = 0;
/** Holds the first DJ pick until its startup reads have settled. */
let pendingDjFirstBatch: string | null = null;

/** Releases [sessionId]'s queued batch after its startup reads finish. */
const finishDjFirstBatch = (sessionId: string): void => {
  if (pendingDjFirstBatch !== sessionId) return;
  pendingDjFirstBatch = null;
  const activeId = activeMagicSession()?.id ?? null;
  if (djBatchReadMayResume(sessionId, activeId)) retryMagicBatch();
};

/**
 * Follows the queue for the Magic Queue under way: plays ending (Next
 * within 30 s, a song played through), stars, songs lined up by hand and
 * recommendations removed teach it; once Up Next holds no recommendation,
 * the next batch joins the end of the queue.
 */
export const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const store = yield* LibraryStore;
    const queue = yield* Queue;
    const ytMusic = yield* YtMusic;
    const player = yield* Player;
    let warmed = recommendationSnapshot.peek();
    const warmInputs = oneAtATime(
      Effect.gen(function* () {
        const library = yield* recommendationSnapshot.library;
        if (library !== warmed.library) {
          warmed = { ...warmed, library };
          if (activeMagicSession()?.continuation) askAgain();
        }
        yield* tasteProfileForRecommendation(library);
        const snapshot = yield* recommendationSnapshot.get;
        if (snapshot.graph !== warmed.graph) {
          warmed = { ...warmed, graph: snapshot.graph };
          if (activeMagicSession()?.continuation) askAgain();
        }
      }).pipe(Effect.provideService(LibraryStore, store)),
    );

    const pendingSignals = new Set<Promise<void>>();
    const waitForSignals = () => Effect.promise(() => Promise.all(pendingSignals));

    /** Teaches the session that was active when the owner acted. */
    const learn = (sessionId: string, kind: MagicSignalKind, trackIds: readonly string[]) =>
      Effect.gen(function* () {
        if (activeMagicSession() === null) return;
        const signals = yield* magicSignalsOf(kind, trackIds).pipe(
          Effect.provideService(LibraryStore, store),
        );
        const session = activeMagicSession();
        if (session?.id !== sessionId || signals.length === 0) return;
        save(signals.reduce((learned, signal) => magicSignal(learned, signal), session));
      });

    /** Learns [kind] about [trackIds] for the next available ranking. */
    const teach = (kind: MagicSignalKind, trackIds: readonly string[]): void => {
      const session = activeMagicSession();
      if (trackIds.length === 0 || session === null) return;
      const learned = Effect.runPromise(
        learn(session.id, kind, trackIds).pipe(
          Effect.catchCause(() => Effect.void),
          namedWork("Magic Queue signals"),
        ),
      );
      pendingSignals.add(learned);
      void learned.finally(() => {
        pendingSignals.delete(learned);
        // A star, a download or a song lined up by hand may find songs an empty pick didn't.
        if (activeMagicSession()?.id === session.id && ASKS_AGAIN.has(kind)) askAgain();
      });
    };

    /**
     * Picks [wanted]'s next batch, weighing every signal so far, and adds it
     * while still wanted; gives how it ended, for the app log (`magicBatchLine`).
     */
    const pick = (wanted: MagicSession, appended: (count: number) => void) =>
      Effect.gen(function* () {
        yield* waitForSignals();
        if (activeMagicSession()?.id !== wanted.id)
          return { kind: "dropped" } satisfies MagicBatchOutcome;
        fork(warmInputs, "Magic Queue inputs");
        const latest = recommendationSnapshot.peek();
        // The batch's JS starts on a free turn, away from the owner's tap.
        yield* freeTurnEffect;
        const library = latest.library ?? startingLibrary;
        const catalog = latest.catalog ?? [];
        const graph = latest.graph;
        const taste = latestTasteProfile();
        // A DJ session ranks with its own choices, whatever Discover's sliders say.
        const sliders = magicSessionSliders(wanted, discoverSliders.get());
        // Built over the whole Library, so in slices too (#1448).
        const profileOf = yield* runSteps(magicProfileOfSteps(library), freeTurnEffect);
        // This batch's radios, drawn once for it and saved before they're read.
        const live = activeMagicSession();
        const drawn = magicBatchRadios(live?.id === wanted.id ? live : wanted, Math.random);
        if (live?.id === wanted.id && drawn.session !== live) save(drawn.session);
        const yt = yield* magicQueueYtCandidates(drawn.session, drawn.seeds, library, {
          catalog,
          graph,
          taste,
          sliders,
          profileOf,
          sessionNow: () => {
            const current = activeMagicSession();
            return current?.id === wanted.id ? current : drawn.session;
          },
        }).pipe(
          Effect.provideService(LibraryStore, store),
          Effect.provideService(YtMusic, ytMusic),
        );
        yield* waitForSignals();
        // The radios' answer is handled on a free turn: their network wait isn't a slice.
        yield* freeTurnEffect;
        const session = activeMagicSession();
        if (
          session?.id !== wanted.id ||
          !wantsMagicBatch(session, queueState.get(), sleepTimerState.get())
        )
          return { kind: "dropped" } satisfies MagicBatchOutcome;
        const candidates = yt.candidates;
        const likedCandidates = yt.likedCandidates;
        // Completed in slices (#1448): the Close fill re-ranks every candidate.
        const batch = yield* runSteps(
          completeMagicRadioBatchSteps(session, candidates, likedCandidates, yt.fallback),
          freeTurnEffect,
        );
        if (batch.trackIds.length === 0)
          return {
            kind: "empty",
            seedGenre: session.seedProfile !== null,
            step: sliderStepLabel(GENRE_FAITHFULNESS_STEPS, sliders.faithfulness),
            library: {
              weighed: (yield* runSteps(filterSteps(library.songs, songHasFile), freeTurnEffect))
                .length,
              admitted: candidates.filter((song) => song.source === "library").length,
            },
            yt: { ranked: yt.ranked, eligible: yt.eligible },
            refill: yt.refilled,
          } satisfies MagicBatchOutcome;
        save(batch.session);
        const songs = batchQueueTracks(batch, library.songs);
        yield* queue.dispatch({ type: "append", trackIds: songs.map((song) => song.id) }, songs);
        appended(songs.length);
        yield* cacheYtCoversInBackground(batchStreams(batch)).pipe(
          Effect.provideService(YtMusic, ytMusic),
          Effect.provideService(Player, player),
        );
        return { kind: "appended", songs: songs.length } satisfies MagicBatchOutcome;
      }).pipe(namedWork("Magic Queue batch"));

    /**
     * Picks a batch for the session under way if it wants one
     * (`wantsMagicBatch`); then whether to pick again (`magicPickEnded`):
     * another session took over while it was picked and wants its own.
     */
    const pickOnce = Effect.suspend(() => {
      const wanted = activeMagicSession();
      if (wanted?.id === pendingDjFirstBatch) return Effect.succeed(false);
      if (
        wanted === null ||
        !magicPickDue(wanted, emptyBatch.get(), queueState.get(), sleepTimerState.get())
      ) {
        // Marked as picked when the session started, and held back since (an End of Queue timer).
        if (wanted !== null && picking.get() === wanted.id) picking.set(null);
        return Effect.succeed(false);
      }
      picking.set(wanted.id);
      failedBatch.set(null);
      let again = false;
      // Asked again while this pick ran: an empty outcome doesn't stand, it picks again.
      const askedBefore = asked;
      let askedMeanwhile = false;
      const timing =
        batchStart?.id === wanted.id
          ? batchStart
          : { id: wanted.id, at: Date.now(), first: wanted.used.length <= 1 };
      let logged = false;
      const log = (outcome: MagicBatchOutcome) => {
        if (logged) return;
        logged = true;
        if (batchStart === timing) batchStart = null;
        appLog(
          "info",
          "WaveTiming",
          magicBatchLine({ first: timing.first, ms: Date.now() - timing.at, outcome }),
        );
      };
      return pick(wanted, (songs) => log({ kind: "appended", songs })).pipe(
        Effect.tap((outcome) =>
          Effect.sync(() => {
            log(outcome);
            if (outcome.kind === "empty") {
              if (asked === askedBefore) emptyBatch.set(wanted.id);
              else askedMeanwhile = true;
            } else if (outcome.kind === "appended") emptyBatch.set(null);
          }),
        ),
        Effect.asVoid,
        Effect.catchCause((cause) =>
          Effect.sync(() => {
            log(
              Cause.hasInterruptsOnly(cause)
                ? { kind: "stopped" }
                : { kind: "failed", reason: String(Cause.squash(cause)) },
            );
            if (!Cause.hasInterruptsOnly(cause) && activeMagicSession()?.id === wanted.id)
              failedBatch.set(wanted.id);
          }),
        ),
        // However the picking ends: added, failed, timed out or no longer wanted.
        Effect.ensuring(
          Effect.sync(() => {
            // Interrupted from outside, past the catch above: its line still goes in.
            log({ kind: "stopped" });
            const ended = magicPickEnded(
              wanted.id,
              picking.get(),
              activeMagicSession(),
              queueState.get(),
              sleepTimerState.get(),
            );
            picking.set(ended.picking);
            again = ended.again || askedMeanwhile;
          }),
        ),
        Effect.map(() => again),
      );
    });

    /**
     * Adds the next batch once the session wants one. Asked for again while
     * it runs, it does nothing (`oneAtATime`), so no two batches are picked
     * at once; a session started meanwhile gets its batch once it's done.
     */
    const fill = oneAtATime(
      Effect.gen(function* () {
        let again = yield* pickOnce;
        while (again) again = yield* pickOnce;
      }),
    );

    const continueOrdinaryQueue = oneAtATime(
      Effect.gen(function* () {
        for (;;) {
          const state = queueState.get();
          const seed = continuationSeedNow(state);
          if (seed === null) return;
          const input = yield* readQueueContinuationSeed(
            seed,
            store,
            queueTracks.get(),
            savedDiscoverMixForContinuation,
          );
          if (queueState.get() !== state) continue;
          if (input === null) return;
          yield* startMagicQueue(input.seed, input.songs, input.streamed, state).pipe(
            Effect.provideService(LibraryStore, store),
            Effect.provideService(Queue, queue),
            Effect.provideService(YtMusic, ytMusic),
            Effect.provideService(Player, player),
          );
          if (queueState.get() === state || activeMagicSession() !== null) return;
        }
      }).pipe(
        Effect.catchCause((cause) =>
          Effect.sync(() => {
            appLog(
              "warn",
              "MagicQueue",
              `Queue continuation failed: ${String(Cause.squash(cause))}`,
            );
          }),
        ),
      ),
    );

    /**
     * Reads the lengths the decision still needs (Core's `queueLengthsToRead`):
     * a few Library songs at a time, only as far as the Buffer reaches, then
     * asks whether the queue continues now.
     */
    const readLengths = oneAtATime(
      Effect.gen(function* () {
        for (;;) {
          const state = queueState.get();
          if (activeMagicSession(state) !== null) return;
          const ids = queueLengths.missing(queueLengthsToRead(state, timeAhead()));
          if (ids.length === 0) return;
          queueLengths.learn(ids, yield* store.songsByIds(ids));
          fork(continueOrdinaryQueue);
        }
      }),
    );
    /**
     * Continues the ordinary queue playing if it is due (Core's
     * `queueContinuation`). Asked at whatever can change the answer: the queue
     * and the song playing, play and pause, the Buffer, the switch, the sleep
     * timer, a length just read. No timer waits for a moment within a song:
     * one set in JS doesn't fire with Wave in the background.
     */
    const followQueueEnd = (): void => {
      const state = queueState.get();
      if (activeMagicSession(state) !== null || !playingCurrentEntry(state)) return;
      fork(continueOrdinaryQueue);
      fork(readLengths);
    };

    /** Clears an empty pick's mark and asks for the batch again: a new signal or a slider move. */
    const askAgain = (): void => {
      asked += 1;
      if (emptyBatch.get() === null) return;
      emptyBatch.set(null);
      fork(fill);
    };

    /**
     * Takes the disliked songs out of the recommendations not yet played
     * (Core's `magicQueueDislikedEntries`): one just disliked, or one the
     * dislikes read at launch hold. The session learns each as a
     * recommendation removed, and picks a batch if none is left.
     */
    const dropDisliked = (): void => {
      const session = activeMagicSession();
      if (session === null) return;
      const keys = magicQueueDislikedEntries(session, queueState.get(), dislikedSongsNow());
      if (keys.length === 0) return;
      fork(
        Effect.gen(function* () {
          for (const key of keys) yield* queue.dispatch({ type: "remove", key });
        }),
      );
    };

    let previous = queueState.get();
    const onQueue = (): void => {
      const state = queueState.get();
      const before = previous;
      previous = state;
      const session = activeMagicSession(state);
      if (session === null) {
        followQueueEnd();
        return;
      }
      if (wantsMagicBatch(session, state) && batchStart?.id !== session.id)
        batchStart = { id: session.id, at: Date.now(), first: session.used.length <= 1 };
      const { added, removed } = magicQueueEdits(session, before, state);
      teach("added", added);
      teach("removed", removed);
      fork(fill);
    };

    yield* Effect.acquireRelease(
      Effect.sync(() => {
        const stops = [
          queueState.subscribe(onQueue),
          magicSession.subscribe(onQueue),
          sleepTimerLoaded.subscribe(onQueue),
          playbackState.subscribe(followQueueEnd),
          // End of Queue turned off: a Magic Queue asks for the batch the timer held back.
          sleepTimerState.subscribe(onQueue),
          subscribeStreamBuffer(followQueueEnd),
          onContinueQueue(followQueueEnd),
          // A play done adding its songs lets its queue continue.
          fillingPlay.subscribe(followQueueEnd),
          subscribeConnectivity(askAgain),
          subscribeYtMusicEnabled(askAgain),
          retryBatch.subscribe(() => fork(fill)),
          discoverSliders.subscribe(askAgain),
          onPlayEnded((end) => {
            const kind = magicPlaySignal(end);
            if (kind !== null) teach(kind, [end.play.trackId]);
          }),
          onYtSongSignal((kind, videoIds) => teach(kind, videoIds.map(ytTrackId))),
          onStarred((trackIds) => teach("favorite", trackIds.map(String))),
          onDislikesChanged(dropDisliked),
        ];
        // Dislikes read before this ran: a queue picked back up may hold one.
        dropDisliked();
        // A Magic Queue picked back up at launch may want its batch already.
        onQueue();
        return stops;
      }),
      (stops) =>
        Effect.sync(() => {
          for (const stop of stops) stop();
        }),
    );
  }),
);
