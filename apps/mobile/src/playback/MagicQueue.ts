import {
  MAGIC_QUEUE_CONTEXT,
  genreProfile,
  isMagicQueue,
  libraryTrackIds,
  magicBatch,
  magicBatchLoading,
  magicLibrarySongs,
  magicPlaySignal,
  magicQueueEdits,
  magicQueueLabel,
  magicSignal,
  parseMagicSession,
  parseTrackId,
  playEndPending,
  startMagicQueue as startSession,
  wantsMagicBatch,
  type MagicSeed,
  type MagicSession,
  type MagicSignalKind,
  type QueueState,
  ytTrackId,
} from "@wave/core";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { Storage } from "expo-sqlite/kv-store";
import { useSyncExternalStore } from "react";

import { makeExternalStore, subscribeAll } from "@/lib/externalStore";
import { oneAtATime } from "@/lib/oneAtATime";
import { onStarred, onYtSongSignal } from "@/library/libraryChanges";
import { LibraryStore, songHasFile, type SongRow } from "@/library/LibraryStore";
import { YtMusic } from "@/ytmusic/YtMusic";

import { magicRadioCandidates, magicStreamedSong } from "./magicQueueRadio";
import { Player } from "./Player";
import { onPlayEnded, playTracker } from "./PlayHistory";
import { Queue, queueState, toQueueTrack, type QueueTrack } from "./Queue";
import { queueTracks, toYtQueueTrack } from "./queueTracks";
import { cacheYtCoversInBackground } from "./ytQueueTracks";

/**
 * The Magic Queue (docs/spec.md, Magic Queue): Core's engine picks the songs
 * and learns; this module starts a session from a long-press menu, feeds it
 * what happens (plays ending, stars, downloads, Up Next edits) and adds a
 * batch once the last recommendation plays, out of the Library and the
 * seed's YouTube Music radio (`magicQueueRadio`), after every signal so far
 * was learned. The session is saved beside the queue, so it goes on after
 * Wave restarts, while the queue is still its own.
 */

const KEY = "playback.magicQueue";

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
  return session === null ? null : magicQueueLabel(session);
};

const subscribeLabel = subscribeAll(queueState, magicSession);

/** "Magic Queue · from <seed>" while the queue is a Magic Queue, else null; re-renders on change. */
export const useMagicQueueLabel = (): string | null =>
  useSyncExternalStore(subscribeLabel, labelNow);

/**
 * The id of the session a batch is being picked for, from the moment it's
 * wanted until it's added, fails, times out or turns out not to be wanted;
 * null while none is.
 */
const picking = makeExternalStore<string | null>(null);

const batchLoadingNow = (): boolean =>
  magicBatchLoading(activeMagicSession(), picking.get(), queueState.get());

const subscribeBatchLoading = subscribeAll(queueState, magicSession, picking);

/**
 * Whether the Magic Queue under way is picking its next batch, which Up Next
 * still waits for (`magicBatchLoading`): false once the batch lands, the
 * picking ends, or something else plays. Re-renders on change.
 */
export const useMagicBatchLoading = (): boolean =>
  useSyncExternalStore(subscribeBatchLoading, batchLoadingNow);

/** The Library's songs and artists: what a Magic Queue grows from, and names its songs' artists. */
const libraryNow = Effect.gen(function* () {
  const store = yield* LibraryStore;
  const songs = yield* store.listSongs;
  const artists = yield* store.listArtists;
  return { songs, artists };
});

/**
 * Starts a Magic Queue from [seed], whose songs are [seedSongs] (the song
 * itself for a song seed): it replaces the queue (with Undo, as any play
 * does) with the seed's first song; the first 9 recommendations follow as
 * the session's first batch, once the seed's radio was read. The radio
 * grows from the seed songs' primary artists, held to their genres.
 */
export const startMagicQueue = (seed: MagicSeed, seedSongs: readonly SongRow[]) =>
  Effect.gen(function* () {
    const playable = seedSongs.filter(songHasFile);
    const artists = yield* (yield* LibraryStore).listArtists;
    const names = new Map(artists.map((artist) => [artist.id, artist.name]));
    const started = startSession(seed, playable.map(magicLibrarySongs(artists)), {
      id: String(Date.now()),
      random: Math.random,
      radio: {
        artists: playable.flatMap((song) => names.get(song.artistId) ?? []),
        profile: genreProfile(playable),
      },
    });
    const first = playable.find((song) => String(song.id) === started?.first);
    if (started === null || first === undefined) return;
    save(started.session);
    // The first batch is on its way as the seed starts: Up Next shows it loading from the first frame.
    picking.set(started.session.id);
    const queue = yield* Queue;
    yield* queue.dispatch(
      {
        type: "play",
        trackIds: [started.first],
        startIndex: 0,
        context: { kind: MAGIC_QUEUE_CONTEXT, id: started.session.id },
        shuffle: false,
      },
      [toQueueTrack(first)],
    );
  });

/** Runs [effect] on its own; the Magic Queue is best effort and never disturbs playback. */
const fork = (effect: Effect.Effect<void, unknown>): void => {
  Effect.runFork(Effect.ignore(effect));
};

/** How many signals are being learned now: a batch waits for them. */
const learning = makeExternalStore(0);

/** The queue's current entry. */
const currentKey = (): string | null => {
  const state = queueState.get();
  return state.entries[state.index]?.key ?? null;
};

/** Whether every signal so far was learned: no play's end is still to come, none is being learned. */
const signalsLearned = (): boolean =>
  learning.get() === 0 && !playEndPending(playTracker.get(), currentKey());

const subscribeSignals = subscribeAll(learning, playTracker, queueState);

/** The longest a batch waits for signals, should the player go quiet (paused mid-crossfade). */
const SIGNALS_WAIT = "15 seconds";

/**
 * Waits until every signal so far was learned (`signalsLearned`): the play
 * that just ended, the 9th song of the batch say, has its say in the next.
 */
const awaitSignals = Effect.callback<void>((resume) => {
  if (signalsLearned()) {
    resume(Effect.void);
    return;
  }
  const stop = subscribeSignals(() => {
    if (!signalsLearned()) return;
    stop();
    resume(Effect.void);
  });
  return Effect.sync(stop);
}).pipe(Effect.timeout(SIGNALS_WAIT), Effect.ignore);

/** Those of [trackIds] the queue holds now. */
const held = (trackIds: readonly string[]): string[] => {
  const queued = new Set(queueState.get().entries.map((entry) => entry.trackId));
  return trackIds.filter((id) => queued.has(id));
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

    /** Teaches the session under way [kind] about each of [trackIds] it holds. */
    const learn = (kind: MagicSignalKind, trackIds: readonly string[]) =>
      Effect.gen(function* () {
        if (activeMagicSession() === null) return;
        const ids = libraryTrackIds(trackIds);
        const library = ids.length === 0 ? [] : yield* store.songsByIds(ids);
        const toMagicSong = magicLibrarySongs(library.length === 0 ? [] : yield* store.listArtists);
        const known = queueTracks.get();
        const streamed = trackIds.flatMap((id) => {
          const track = known.get(id);
          return track === undefined || parseTrackId(id)?.kind !== "yt"
            ? []
            : [magicStreamedSong({ id, artists: track.artists ?? [track.artist] })];
        });
        const songs = [...library.map(toMagicSong), ...streamed];
        const session = activeMagicSession();
        if (session === null || songs.length === 0) return;
        save(songs.reduce((learned, song) => magicSignal(learned, { kind, song }), session));
      });

    /** Learns [kind] about [trackIds] on its own, counted (`learning`) until it's done. */
    const teach = (kind: MagicSignalKind, trackIds: readonly string[]): void => {
      if (trackIds.length === 0 || activeMagicSession() === null) return;
      learning.update((count) => count + 1);
      fork(
        learn(kind, trackIds).pipe(
          Effect.ensuring(Effect.sync(() => learning.update((count) => count - 1))),
        ),
      );
    };

    /**
     * Adds the next batch once the session wants one (`wantsMagicBatch`),
     * weighing every signal so far. Asked for again while it runs, it does
     * nothing (`oneAtATime`), so no two batches are picked at once.
     */
    const fill = oneAtATime(
      Effect.gen(function* () {
        const wanted = activeMagicSession();
        if (wanted === null || !wantsMagicBatch(wanted, queueState.get())) return;
        picking.set(wanted.id);
        yield* awaitSignals;
        const library = yield* Effect.provideService(libraryNow, LibraryStore, store);
        const yt = yield* magicRadioCandidates(wanted, library).pipe(
          Effect.provideService(LibraryStore, store),
          Effect.provideService(YtMusic, ytMusic),
        );
        // Signals may have come, and the queue moved on, while the radio was read.
        yield* awaitSignals;
        const session = activeMagicSession();
        if (session?.id !== wanted.id || !wantsMagicBatch(session, queueState.get())) return;
        const playable = library.songs.filter(songHasFile);
        const toMagicSong = magicLibrarySongs(library.artists);
        const batch = magicBatch(session, playable.map(toMagicSong), Math.random, yt);
        if (batch.trackIds.length === 0) return;
        save(batch.session);
        const tracks = new Map<string, QueueTrack>(
          playable.map((song) => [String(song.id), toQueueTrack(song)]),
        );
        for (const candidate of yt)
          tracks.set(candidate.trackId, toYtQueueTrack(candidate.song, null));
        const songs = batch.trackIds.flatMap((id) => tracks.get(id) ?? []);
        yield* queue.dispatch({ type: "append", trackIds: songs.map((song) => song.id) }, songs);
        const picked = new Set(batch.trackIds);
        yield* cacheYtCoversInBackground(
          yt
            .filter((candidate) => picked.has(candidate.trackId))
            .map((candidate) => candidate.song),
        ).pipe(Effect.provideService(YtMusic, ytMusic), Effect.provideService(Player, player));
      }).pipe(
        // However the picking ends: added, failed, timed out or no longer wanted.
        Effect.ensuring(Effect.sync(() => picking.set(null))),
      ),
    );

    let previous = queueState.get();
    const onQueue = (): void => {
      const state = queueState.get();
      const before = previous;
      previous = state;
      const session = activeMagicSession(state);
      if (session === null) return;
      const { added, removed } = magicQueueEdits(session, before, state);
      teach("added", added);
      teach("removed", removed);
      fork(fill);
    };

    yield* Effect.acquireRelease(
      Effect.sync(() => {
        const stops = [
          queueState.subscribe(onQueue),
          onPlayEnded((end) => {
            const kind = magicPlaySignal(end);
            if (kind !== null) teach(kind, [end.play.trackId]);
          }),
          onYtSongSignal((kind, videoIds) => teach(kind, held(videoIds.map(ytTrackId)))),
          onStarred((trackIds) => teach("favorite", held(trackIds.map(String)))),
        ];
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
