import {
  MAGIC_QUEUE_CONTEXT,
  isMagicQueue,
  libraryTrackIds,
  magicBatch,
  magicPlaySignal,
  magicQueueEdits,
  magicQueueLabel,
  magicSignal,
  parseMagicSession,
  startMagicQueue as startSession,
  wantsMagicBatch,
  type MagicSeed,
  type MagicSession,
  type MagicSignalKind,
  type MagicSong,
  type QueueState,
} from "@wave/core";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { Storage } from "expo-sqlite/kv-store";
import { useSyncExternalStore } from "react";

import { makeExternalStore } from "@/lib/externalStore";
import { onStarred } from "@/library/libraryChanges";
import {
  LibraryStore,
  songHasFile,
  type PlayableSongRow,
  type SongRow,
} from "@/library/LibraryStore";

import { onPlayEnded } from "./PlayHistory";
import { Queue, queueState, toQueueTrack } from "./Queue";

/**
 * The Magic Queue (docs/spec.md, Magic Queue): Core's engine picks the songs
 * and learns; this module starts a session from a long-press menu, feeds it
 * what happens (plays ending, stars, Up Next edits) and adds a batch once
 * the last recommendation plays. The session is saved beside the queue, so
 * it goes on after Wave restarts, while the queue is still its own.
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

const subscribeLabel = (listener: () => void): (() => void) => {
  const stopQueue = queueState.subscribe(listener);
  const stopSession = magicSession.subscribe(listener);
  return () => {
    stopQueue();
    stopSession();
  };
};

/** "Magic Queue · from <seed>" while the queue is a Magic Queue, else null; re-renders on change. */
export const useMagicQueueLabel = (): string | null =>
  useSyncExternalStore(subscribeLabel, labelNow);

/** A Library song as the engine weighs it. */
const toMagicSong = (song: SongRow): MagicSong => ({
  trackId: String(song.id),
  artists: song.artistIds.map(String),
  genre: song.genre,
});

/** The Library songs that can play: what a Magic Queue grows from. */
const librarySongs = Effect.gen(function* () {
  const store = yield* LibraryStore;
  const songs = yield* store.listSongs;
  return songs.filter(songHasFile);
});

/**
 * Starts a Magic Queue from [seed], whose songs are [seedSongs] (the song
 * itself for a song seed): it replaces the queue (with Undo, as any play
 * does) with the seed's first song and the first 9 recommendations.
 */
export const startMagicQueue = (seed: MagicSeed, seedSongs: readonly SongRow[]) =>
  Effect.gen(function* () {
    const playable = seedSongs.filter(songHasFile);
    const started = startSession(seed, playable.map(toMagicSong), {
      id: String(Date.now()),
      random: Math.random,
    });
    if (started === null) return;
    const library = yield* librarySongs;
    const batch = magicBatch(started.session, library.map(toMagicSong), Math.random);
    const byId = new Map<string, PlayableSongRow>(
      [...library, ...playable].map((song) => [String(song.id), song]),
    );
    const songs = [started.first, ...batch.trackIds].flatMap((id) => byId.get(id) ?? []);
    save(batch.session);
    const queue = yield* Queue;
    yield* queue.dispatch(
      {
        type: "play",
        trackIds: songs.map((song) => String(song.id)),
        startIndex: 0,
        context: { kind: MAGIC_QUEUE_CONTEXT, id: batch.session.id },
        shuffle: false,
      },
      songs.map(toQueueTrack),
    );
  });

/** Runs [effect] on its own; the Magic Queue is best effort and never disturbs playback. */
const fork = (effect: Effect.Effect<void, unknown>): void => {
  Effect.runFork(Effect.ignore(effect));
};

/**
 * Follows the queue for the Magic Queue under way: plays ending (a skip
 * within 30 s, a song played through), stars, songs lined up by hand and
 * recommendations removed teach it; once Up Next holds no recommendation,
 * the next batch joins the end of the queue.
 */
export const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const store = yield* LibraryStore;
    const queue = yield* Queue;

    /** Teaches the session under way [kind] about each of [trackIds] it holds. */
    const learn = (kind: MagicSignalKind, trackIds: readonly string[]) =>
      Effect.gen(function* () {
        const ids = libraryTrackIds(trackIds);
        if (activeMagicSession() === null || ids.length === 0) return;
        const songs = yield* store.songsByIds(ids);
        const session = activeMagicSession();
        if (session === null) return;
        save(
          songs.reduce(
            (learned, song) => magicSignal(learned, { kind, song: toMagicSong(song) }),
            session,
          ),
        );
      });

    let filling = false;

    /** Adds the next batch once the session wants one (`wantsMagicBatch`). */
    const fill = Effect.gen(function* () {
      const session = activeMagicSession();
      if (filling || session === null || !wantsMagicBatch(session, queueState.get())) return;
      filling = true;
      const library = yield* Effect.provideService(librarySongs, LibraryStore, store);
      const batch = magicBatch(session, library.map(toMagicSong), Math.random);
      // Something else may have played meanwhile.
      if (activeMagicSession()?.id !== session.id || batch.trackIds.length === 0) return;
      save(batch.session);
      const byId = new Map(library.map((song) => [String(song.id), song]));
      const songs = batch.trackIds.flatMap((id) => byId.get(id) ?? []);
      yield* queue.dispatch(
        { type: "append", trackIds: songs.map((song) => String(song.id)) },
        songs.map(toQueueTrack),
      );
    }).pipe(
      Effect.ensuring(
        Effect.sync(() => {
          filling = false;
        }),
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
      fork(
        Effect.gen(function* () {
          yield* learn("added", added);
          yield* learn("removed", removed);
          yield* fill;
        }),
      );
    };

    yield* Effect.acquireRelease(
      Effect.sync(() => {
        const stops = [
          queueState.subscribe(onQueue),
          onPlayEnded((play) => {
            const kind = magicPlaySignal(play);
            if (kind !== null) fork(learn(kind, [play.trackId]));
          }),
          onStarred((trackIds) => {
            const held = new Set(queueState.get().entries.map((entry) => entry.trackId));
            const starred = trackIds.map(String).filter((id) => held.has(id));
            fork(learn("favorite", starred));
          }),
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
