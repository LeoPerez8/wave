import {
  libraryTrackIds,
  playerKeepsPlaying,
  restorableTrack,
  restorePlayback,
  resumesAfterReload,
  savedQueueState,
} from "@wave/core";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { AppState } from "react-native";

import { LibraryStore } from "@/library/LibraryStore";
import { appLog } from "@/log/appLog";
import { ytMusicEnabled } from "@/settings/ytMusic";

import { Player, playbackState } from "./Player";
import { Queue, currentPositionMs, queueState, settledQueue, toQueueTrack } from "./Queue";
import { observeQueueSaves } from "./queueSaves";
import { learnUnknownQueueTracks, queueTracks, type QueueTrack } from "./queueTracks";
import { onSavePlaceForReload, takePlayingAtReload } from "./reloadResume";
import { savedYtQueueTracks, saveYtQueueTracks } from "./savedYtTracks";

/** Saving is best effort: a failed write must never disturb playback. */
const run = (effect: Effect.Effect<void, unknown>): void => {
  Effect.runFork(effect.pipe(Effect.ignore));
};

/**
 * Keeps the queue, current track, position, shuffle and repeat in the library
 * database, and on launch puts them back (paused) when Wave's process had
 * ended. While the process lives, `Queue` picks the queue up from the player.
 * After Install Now's reload with music playing, a player that came back
 * stopped plays the queue again (`reloadResume`).
 */
export const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const store = yield* LibraryStore;
    const queue = yield* Queue;
    const player = yield* Player;
    // Read once at the launch, whatever comes of the restore.
    const playingAtReload = takePlayingAtReload();

    const resumeAfterReload = Effect.suspend(() => {
      const resumes = resumesAfterReload({
        playingAtReload,
        now: Date.now(),
        playing: playerKeepsPlaying(playbackState.get()),
        queueLoaded: queueState.get().entries.length > 0,
      });
      if (!resumes) return Effect.void;
      appLog("info", "WaveUpdates", "Playing the queue again after the reload");
      return player.play;
    }).pipe(Effect.ignore);

    const restore = Effect.gen(function* () {
      const saved = yield* store.loadPlayback;
      if (saved === null) return;
      const state = savedQueueState(saved.parts);
      if (state === null) return;
      const songs = yield* store.songsByIds(
        libraryTrackIds(state.entries.map((entry) => entry.trackId)),
      );
      const ytTracks = savedYtQueueTracks();
      const restored = restorePlayback(
        state,
        saved.positionMs,
        restorableTrack({
          libraryIds: new Set(songs.map((song) => song.id)),
          savedYtTracks: new Set(ytTracks.map((track) => track.id)),
          ytMusicOn: ytMusicEnabled(),
        }),
      );
      if (restored === null) return;
      yield* queue.restore(
        restored.state,
        [...songs.map(toQueueTrack), ...ytTracks],
        restored.positionMs,
      );
    });

    let savedTracks: ReadonlyMap<string, QueueTrack> | null = null;
    /** The restore is over, so a save can't overwrite the saved place with an empty queue. */
    let restored = false;

    const saves = yield* Effect.acquireRelease(
      Effect.sync(() => {
        const saves = observeQueueSaves({
          playback: playbackState,
          settled: settledQueue,
          positionMs: currentPositionMs,
          saveQueue: (write) => {
            // Its YT Music songs aren't in the Library: their details go with it, when
            // its entries or their details (a cover cached later) changed.
            const tracks = queueTracks.get();
            if (write.queue !== undefined || tracks !== savedTracks) {
              savedTracks = tracks;
              run(Effect.sync(() => saveYtQueueTracks(queueState.get().entries)));
            }
            run(store.saveQueue(write));
          },
          savePosition: (positionMs) => run(store.savePosition(positionMs)),
        });
        // A queue picked back up from the player comes without its tracks:
        // read them as soon as it's there, before Up Next is opened.
        const stopLearning = queueState.subscribe(() => {
          Effect.runFork(
            learnUnknownQueueTracks(queueState.get().entries, store.songsByIds, savedYtQueueTracks),
          );
        });
        const leaving = AppState.addEventListener("change", (next) => {
          if (next === "active") return;
          Effect.runSync(queue.flush);
          saves.savePositionNow();
        });
        // Install Now's reload waits for this, in case the player doesn't play through it.
        const stopReloadSaves = onSavePlaceForReload(() => {
          if (!restored) return Promise.resolve();
          Effect.runSync(queue.flush);
          return Effect.runPromise(store.savePosition(currentPositionMs()).pipe(Effect.ignore));
        });
        return {
          saves,
          stop: () => {
            saves.stop();
            stopLearning();
            leaving.remove();
            stopReloadSaves();
          },
        };
      }),
      ({ stop }) => queue.flush.pipe(Effect.andThen(Effect.sync(stop))),
    ).pipe(Effect.map(({ saves }) => saves));

    // Saving starts after the restore so an empty queue at startup can't overwrite the saved one.
    yield* Effect.forkScoped(
      restore.pipe(
        Effect.ignore,
        Effect.ensuring(
          Effect.sync(() => {
            restored = true;
            saves.start();
          }),
        ),
        Effect.andThen(resumeAfterReload),
      ),
    );
  }),
);
