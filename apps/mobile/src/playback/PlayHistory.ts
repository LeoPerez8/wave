import {
  EMPTY_PLAY_TRACKER,
  playSoFar,
  resumePlay,
  trackPlays,
  type PlaybackSignal,
  type PlayTrack,
} from "@wave/core";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import { AppState } from "react-native";

import { makeExternalStore } from "@/lib/externalStore";
import { LibraryStore } from "@/library/LibraryStore";

import { Player, playbackState } from "./Player";
import { keptPlayingKey, queueSource, queueState } from "./Queue";

/** Bumped whenever a play starts or ends; Home re-reads on it while focused (`useFocusedVersion`). */
export const playHistoryVersion = makeExternalStore(0);

/** How often a play still going on is brought up to date, should Wave's process die. */
const SAVE_INTERVAL_MS = 15_000;

type StateSignal = Extract<PlaybackSignal, { type: "state" }>;

/** The track behind a queue entry, with the context it came from (none for Play Next / Add to Queue). */
const trackFor = (key: string): PlayTrack | null => {
  const queue = queueState.get();
  const entry = queue.entries.find((candidate) => candidate.key === key);
  if (entry === undefined) return null;
  return {
    trackId: entry.trackId,
    context: entry.contextIndex === null ? null : queue.context,
    source: queueSource.get(),
  };
};

/**
 * Runs a store call. Calls are synchronous (expo-sqlite), which keeps them in
 * signal order. Recording is best effort: a failed call must never disturb playback.
 */
const write = <A>(effect: Effect.Effect<A, unknown>): A | null => {
  const exit = Effect.runSyncExit(effect);
  return Exit.isSuccess(exit) ? exit.value : null;
};

/**
 * Records a play event for every time a track starts playing. Core's
 * `trackPlays` follows the player (state, item transitions, seeks) and says
 * when a play starts and ends; a play is written as it starts and kept up to
 * date (on pause, every 15 s, on leaving the app), so one cut short by Wave's
 * process dying is still on record, as interrupted (or stopped, if paused).
 * When JS restarts while the player kept going, the play on record goes on.
 */
export const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const store = yield* LibraryStore;
    const player = yield* Player;

    let tracker = EMPTY_PLAY_TRACKER;
    let rowId: number | null = null;
    let lastSave = 0;
    let wasPlaying = false;
    // Whether the player keeping a play going through a JS restart was checked for.
    let resumeChecked = false;

    const saveProgress = (): void => {
      const play = playSoFar(tracker, Date.now());
      lastSave = Date.now();
      if (rowId !== null && play !== null) write(store.updatePlay(rowId, play));
    };

    const feed = (signal: PlaybackSignal): void => {
      const result = trackPlays(tracker, signal);
      tracker = result.state;
      for (const step of result.steps) {
        if (step.type === "started") {
          rowId = write(store.recordPlay(step.play));
          lastSave = Date.now();
        } else {
          if (rowId !== null) write(store.updatePlay(rowId, step.play));
          rowId = null;
        }
        playHistoryVersion.update((version) => version + 1);
      }
    };

    /**
     * The first time a play could open, checks whether the player kept it going
     * while JS restarted; if so, the play on record goes on instead.
     */
    const resume = (signal: StateSignal): void => {
      if (resumeChecked || tracker.play !== null || signal.track === null) return;
      resumeChecked = true;
      if (signal.key === null || signal.key !== keptPlayingKey.get()) return;
      const latest = write(store.latestPlay);
      const resumed = latest === null ? null : resumePlay(latest.play, signal);
      if (latest === null || resumed === null) return;
      tracker = resumed;
      rowId = latest.id;
      lastSave = Date.now();
    };

    const onPlaybackState = (): void => {
      const state = playbackState.get();
      const key = state.item?.id ?? null;
      // The track only matters when a play may open: none is, or the entry changed.
      const noTrackNeeded = key === null || tracker.play?.key === key;
      const signal: StateSignal = {
        type: "state",
        at: state.at > 0 ? state.at : Date.now(),
        key,
        status: state.status,
        playing: state.isPlaying,
        durationMs: state.durationMs,
        track: noTrackNeeded ? null : trackFor(key),
      };
      resume(signal);
      feed(signal);
      const pausedOrResumed = wasPlaying !== state.isPlaying;
      wasPlaying = state.isPlaying;
      if (pausedOrResumed || (state.isPlaying && Date.now() - lastSave >= SAVE_INTERVAL_MS))
        saveProgress();
    };

    yield* player.onItemTransition((event) =>
      feed({ type: "transition", at: Date.now(), key: event.itemId, reason: event.reason }),
    );
    yield* player.onSeek((event) =>
      feed({
        type: "seek",
        at: event.at,
        key: event.itemId,
        fromMs: event.fromMs,
        toMs: event.toMs,
      }),
    );

    yield* Effect.acquireRelease(
      Effect.sync(() => {
        const unsubscribe = playbackState.subscribe(onPlaybackState);
        const appState = AppState.addEventListener("change", (next) => {
          if (next !== "active") saveProgress();
        });
        // The player may already be playing (JS restarted while it kept going).
        onPlaybackState();
        return () => {
          appState.remove();
          unsubscribe();
        };
      }),
      (unsubscribe) =>
        Effect.sync(() => {
          saveProgress();
          unsubscribe();
        }),
    );
  }),
);
