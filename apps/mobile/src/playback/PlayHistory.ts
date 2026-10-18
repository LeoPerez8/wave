import {
  EMPTY_PLAY_TRACKER,
  fadingPlaySoFar,
  movedToFollowing,
  parseTrackId,
  playSoFar,
  resumePlay,
  trackPlays,
  type PlaybackSignal,
  type PlayEnd,
  type PlayTrack,
  type PlayEvent,
  type PlayTrackerState,
} from "@wave/core";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import { AppState } from "react-native";

import { makeExternalStore } from "@/lib/externalStore";
import { publishLibraryChange } from "@/library/libraryChanges";
import { LibraryStore } from "@/library/LibraryStore";

import { Player, playbackState } from "./Player";
import { keptPlayingKey, queueSource, queueState } from "./Queue";
import { queuedYtSong, queueTracks } from "./queueTracks";

/** Bumped whenever a play starts or ends; Stats re-read on it while focused (`useFocusedVersion`). */
export const playHistoryVersion = makeExternalStore(0);

/**
 * The play history changed (a play started or ended, plays were imported or
 * synced): bumps `playHistoryVersion` and tells shared queries over plays
 * (Home). Plays only add to the history, so they're a burst: screens in
 * sight re-read at most every 1.5 s, hidden ones (Home under Now Playing)
 * when they come back. [trackIds]: the tracks played, when known.
 */
export const playHistoryChanged = (trackIds?: readonly number[]): void => {
  playHistoryVersion.update((version) => version + 1);
  publishLibraryChange({
    kind: "plays",
    ...(trackIds === undefined ? {} : { ids: trackIds }),
    burst: true,
  });
};

const playEndListeners = new Set<(end: PlayEnd) => void>();

/**
 * Calls [listener] with every play as it ends (how long it was listened
 * to, how it ended, whether by Next), a streamed song's too though it's
 * never on record: the Magic Queue learns skips and songs played through
 * from them. Returns how to stop.
 */
export const onPlayEnded = (listener: (end: PlayEnd) => void): (() => void) => {
  playEndListeners.add(listener);
  return () => {
    playEndListeners.delete(listener);
  };
};

/**
 * The plays the tracker follows now, set once the listeners heard each end
 * so far: with Core's `playEndPending`, whether a play's end is yet to come.
 */
export const playTracker = makeExternalStore<PlayTrackerState>(EMPTY_PLAY_TRACKER);

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

/** A play's row, by its song and start: during a crossfade two plays are on record at once. */
const identity = (play: PlayEvent): string => `${play.trackId}:${play.startedAt}`;

/**
 * Records a play event for every time a track starts playing. Core's
 * `trackPlays` follows the player (state, item transitions, seeks) and says
 * when a play starts and ends; a play is written as it starts and kept up to
 * date (on pause, every 15 s, on leaving the app), so one cut short by Wave's
 * process dying is still on record, as interrupted (or stopped, if paused).
 * When JS restarts while the player kept going, the play on record goes on.
 * During a crossfade the outgoing song's play goes on, alongside the next
 * one's, until its fade ends.
 */
export const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const store = yield* LibraryStore;
    const player = yield* Player;

    let tracker = EMPTY_PLAY_TRACKER;
    const rowIds = new Map<string, number>();
    let lastSave = 0;
    let wasPlaying = false;
    // Whether the player keeping a play going through a JS restart was checked for.
    let resumeChecked = false;
    // The queue entry last looked at for a streamed song, so each one is noted once.
    let streamedKey: string | null = null;

    /**
     * Notes a YT Music song as streamed once its entry starts playing. Streamed
     * plays aren't play history (`trackPlays`); Home's mixes read them, so a
     * song the owner streamed is never new to them.
     */
    const noteStreamed = (key: string | null, playing: boolean, at: number): void => {
      if (!playing || key === null || key === streamedKey) return;
      streamedKey = key;
      const trackId = trackFor(key)?.trackId;
      const track = trackId === undefined ? undefined : queueTracks.get().get(trackId);
      const song = track === undefined ? null : queuedYtSong(track);
      if (song === null) return;
      write(store.noteStreamedSong(song, at));
      publishLibraryChange({ kind: "streamed", burst: true });
    };

    const saveProgress = (): void => {
      lastSave = Date.now();
      for (const play of [playSoFar(tracker, lastSave), fadingPlaySoFar(tracker, lastSave)]) {
        if (play === null) continue;
        const rowId = rowIds.get(identity(play));
        if (rowId !== undefined) write(store.updatePlay(rowId, play));
      }
    };

    const feed = (signal: PlaybackSignal): void => {
      const result = trackPlays(tracker, signal);
      tracker = result.state;
      for (const step of result.steps) {
        if (step.type === "heard") {
          // A streamed song's play: never on record, but its listeners learn from it.
          for (const listener of playEndListeners) listener(step);
          continue;
        }
        // The play's row, if it has one: a play the store couldn't record changed no history.
        let rowId: number | null | undefined;
        if (step.type === "started") {
          rowId = write(store.recordPlay(step.play, tracker.fading !== null));
          if (rowId !== null) rowIds.set(identity(step.play), rowId);
          lastSave = Date.now();
        } else {
          rowId = rowIds.get(identity(step.play));
          if (rowId !== undefined) write(store.endPlay(rowId, step.play));
          rowIds.delete(identity(step.play));
          for (const listener of playEndListeners) listener(step);
        }
        if (rowId === null || rowId === undefined) continue;
        // Only a Library song has an id to name; a streamed play (`yt:<videoId>`) has none.
        const played = parseTrackId(step.play.trackId);
        playHistoryChanged(played?.kind === "library" ? [played.id] : undefined);
      }
      playTracker.set(tracker);
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
      rowIds.set(identity(latest.play), latest.id);
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
      noteStreamed(key, state.isPlaying, signal.at);
      const pausedOrResumed = wasPlaying !== state.isPlaying;
      wasPlaying = state.isPlaying;
      if (pausedOrResumed || (state.isPlaying && Date.now() - lastSave >= SAVE_INTERVAL_MS))
        saveProgress();
    };

    yield* player.onItemTransition((event) =>
      feed({
        type: "transition",
        at: Date.now(),
        key: event.itemId,
        reason: event.reason,
        // Next, from Wave, the notification or a headset: on to the entry after the one left.
        toFollowing: movedToFollowing(queueState.get(), tracker.play?.key ?? null, event.itemId),
      }),
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
    yield* player.onCrossfade((event) => feed({ type: "fadeEnded", at: event.at }));

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
