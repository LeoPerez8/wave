import { parseQueueState, restorePlayback } from "@wave/core";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { AppState } from "react-native";

import { LibraryStore } from "@/library/LibraryStore";

import { playbackState } from "./Player";
import { Queue, currentPositionMs, queueState, settledQueue, toQueueTrack } from "./Queue";
import { learnUnknownQueueTracks } from "./queueTracks";

/** How often the position is written while playing; it's also written on pause and on leaving the app. */
const POSITION_SAVE_INTERVAL_MS = 5_000;

/** Saving is best effort: a failed write must never disturb playback. */
const run = (effect: Effect.Effect<void, unknown>): void => {
  Effect.runFork(effect.pipe(Effect.ignore));
};

/**
 * Keeps the queue, current track, position, shuffle and repeat in the library
 * database, and on launch puts them back (paused) when Wave's process had
 * ended. While the process lives, `Queue` picks the queue up from the player.
 */
export const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const store = yield* LibraryStore;
    const queue = yield* Queue;

    const restore = Effect.gen(function* () {
      const saved = yield* store.loadPlayback;
      if (saved === null) return;
      const state = parseQueueState(yield* Effect.try(() => JSON.parse(saved.queue) as unknown));
      if (state === null) return;
      const ids = [...new Set(state.entries.map((entry) => Number(entry.trackId)))];
      const songs = yield* store.songsByIds(ids.filter(Number.isInteger));
      const available = new Set(songs.map((song) => String(song.id)));
      const restored = restorePlayback(state, saved.positionMs, (id) => available.has(id));
      if (restored === null) return;
      yield* queue.restore(restored.state, songs.map(toQueueTrack), restored.positionMs);
    });

    let saving = false;
    let lastPositionSave = 0;

    const savePosition = (): void => {
      lastPositionSave = Date.now();
      run(store.savePosition(currentPositionMs()));
    };

    let wasPlaying = false;

    yield* Effect.acquireRelease(
      Effect.sync(() => [
        // A queue picked back up from the player comes without its tracks:
        // read them as soon as it's there, before Up Next is opened.
        queueState.subscribe(() => {
          Effect.runFork(learnUnknownQueueTracks(queueState.get().entries, store.songsByIds));
        }),
        // `Queue` serialises the queue once changes settle (skips, reorders come in bursts).
        settledQueue.subscribe(() => {
          const json = settledQueue.get();
          if (!saving || json === null) return;
          lastPositionSave = Date.now();
          run(store.saveQueue(json, currentPositionMs()));
        }),
        playbackState.subscribe(() => {
          if (!saving) return;
          const { isPlaying } = playbackState.get();
          const paused = wasPlaying && !isPlaying;
          wasPlaying = isPlaying;
          // Track changes reach the queue, whose save carries the position too.
          if (paused || (isPlaying && Date.now() - lastPositionSave >= POSITION_SAVE_INTERVAL_MS)) {
            savePosition();
          }
        }),
        (() => {
          const subscription = AppState.addEventListener("change", (next) => {
            if (!saving || next === "active") return;
            Effect.runSync(queue.flush);
            savePosition();
          });
          return () => subscription.remove();
        })(),
      ]),
      (unsubscribes) =>
        queue.flush.pipe(
          Effect.andThen(
            Effect.sync(() => {
              for (const unsubscribe of unsubscribes) unsubscribe();
            }),
          ),
        ),
    );

    // Saving starts after the restore so an empty queue at startup can't overwrite the saved one.
    yield* Effect.forkScoped(
      restore.pipe(
        Effect.ignore,
        Effect.ensuring(
          Effect.sync(() => {
            saving = true;
            wasPlaying = playbackState.get().isPlaying;
          }),
        ),
      ),
    );
  }),
);
