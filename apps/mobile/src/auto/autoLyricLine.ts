/**
 * Keeps the lyric line on Android Auto's player screen in time with the song.
 * Core's `autoLyricLine` decides what shows; this reads the playing track's
 * lyrics, asks it at each position report, seek and toggle change, and wakes
 * up again when the next line is due. Kept free of Expo so it runs under
 * plain Node tests.
 */
import { autoLyricLine, extrapolatePosition, type Lyrics } from "@wave/core";

import type { ExternalStore } from "../lib/externalStore.ts";

/** What the line needs to know of the player (the app's `PlaybackState` fits). */
export interface AutoLyricLinePlayback {
  /** The playing item; `id` is its queue entry key. */
  readonly item: { readonly id: string } | null;
  readonly positionMs: number;
  readonly durationMs: number | null;
  /** Wall-clock time (ms) the position was read at. */
  readonly at: number;
  readonly isPlaying: boolean;
}

/** The Lyrics toggle on Auto's player screen, and whether Auto is connected. */
export interface AutoLyricsToggle {
  readonly on: boolean;
  readonly carConnected: boolean;
}

export interface AutoLyricLinePorts {
  /** The player as the app mirrors it; only read and followed. */
  readonly playback: Pick<ExternalStore<AutoLyricLinePlayback>, "get" | "subscribe">;
  /** The audio file of a queue entry, if the queue knows it. */
  readonly pathOf: (itemId: string) => string | null;
  /** The lyrics to show for a file (the Lyrics view's). */
  readonly readLyrics: (path: string) => Promise<Lyrics>;
  /** Shows `line` under the title of `itemId` in place of the artist; null shows the artist. */
  readonly show: (itemId: string | null, line: string | null) => void;
}

export interface AutoLyricLineSync {
  /** The toggle or Auto's connection changed (the native side reports both). */
  readonly setToggle: (toggle: AutoLyricsToggle) => void;
  readonly stop: () => void;
}

const NONE: Lyrics = { kind: "none" };

/** Follows the player and shows the line until `stop`; the toggle starts off. */
export const startAutoLyricLine = (ports: AutoLyricLinePorts): AutoLyricLineSync => {
  let toggle: AutoLyricsToggle = { on: false, carConnected: false };
  /** The lyrics of one item; null while they are read. */
  let loaded: { readonly itemId: string; readonly lyrics: Lyrics | null } | null = null;
  /** What was last sent, so position reports don't resend it. */
  let sent: { readonly itemId: string | null; readonly line: string | null } | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;

  const load = (itemId: string): void => {
    const path = ports.pathOf(itemId);
    // Not queued yet (a resumed queue JS hasn't taken over): the next report tries again.
    if (path === null) return;
    loaded = { itemId, lyrics: null };
    ports
      .readLyrics(path)
      // A file that can't be read has no lyrics to show.
      .catch(() => NONE)
      .then((lyrics) => {
        if (loaded?.itemId !== itemId) return;
        loaded = { itemId, lyrics };
        update();
      });
  };

  const update = (): void => {
    if (stopped) return;
    if (timer !== null) clearTimeout(timer);
    timer = null;
    const state = ports.playback.get();
    const itemId = state.item?.id ?? null;
    const showing = toggle.on && toggle.carConnected;
    if (showing && itemId !== null && loaded?.itemId !== itemId) load(itemId);
    const lyrics = loaded !== null && loaded.itemId === itemId ? loaded.lyrics : null;
    const positionMs = extrapolatePosition(state, Date.now());
    const { line, nextChangeMs } = autoLyricLine({ ...toggle, lyrics, positionMs });
    if (sent?.itemId !== itemId || sent.line !== line) {
      sent = { itemId, line };
      ports.show(itemId, line);
    }
    if (state.isPlaying && nextChangeMs !== null) {
      timer = setTimeout(update, Math.max(0, nextChangeMs - positionMs));
    }
  };

  const unsubscribe = ports.playback.subscribe(update);

  return {
    setToggle: (next) => {
      toggle = next;
      // The native side drops its line when either turns off; send the line afresh.
      sent = null;
      update();
    },
    stop: () => {
      stopped = true;
      unsubscribe();
      if (timer !== null) clearTimeout(timer);
      timer = null;
    },
  };
};
