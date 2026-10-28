/**
 * Keeps the lyrics Wave shows as the title and artist on Android Auto's
 * player screen in time with the song. Core's `autoLyricLines` decides what shows; this reads the playing
 * track's lyrics, asks it at each position report, seek and toggle change,
 * and wakes up again when the next chunk of words is due. Kept free of Expo so it runs
 * under plain Node tests.
 */
import { autoLyricLines, extrapolatePosition, type AutoLyricsText, type Lyrics } from "@wave/core";

import type { ExternalStore } from "../lib/externalStore.ts";

/** What the lyrics need to know of the player (the app's `PositionState` fits). */
export interface AutoLyricLinesPlayback {
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

export interface AutoLyricLinesPorts {
  /** Subscribing acquires position reports, so follow only while car lyrics are shown. */
  readonly playback: Pick<ExternalStore<AutoLyricLinesPlayback>, "get" | "subscribe">;
  /** The audio file of a queue entry, if the queue knows it. */
  readonly pathOf: (itemId: string) => string | null;
  /** The lyrics to show for a file (the Lyrics view's). */
  readonly readLyrics: (path: string) => Promise<Lyrics>;
  /** Shows `text` as the title and artist of `itemId`; null shows its own. */
  readonly show: (itemId: string | null, text: AutoLyricsText | null) => void;
}

export interface AutoLyricLinesSync {
  /** The toggle or Auto's connection changed (the native side reports both). */
  readonly setToggle: (toggle: AutoLyricsToggle) => void;
  readonly stop: () => void;
}

const NONE: Lyrics = { kind: "none" };

/** Whether two texts show the same title and artist. */
const sameText = (a: AutoLyricsText | null, b: AutoLyricsText | null): boolean =>
  a === b || (a !== null && b !== null && a.title === b.title && a.artist === b.artist);

/** Follows the player and shows the lyrics until `stop`; the toggle starts off. */
export const startAutoLyricLines = (ports: AutoLyricLinesPorts): AutoLyricLinesSync => {
  let toggle: AutoLyricsToggle = { on: false, carConnected: false };
  /** The lyrics of one item; null while they are read. */
  let loaded: { readonly itemId: string; readonly lyrics: Lyrics | null } | null = null;
  /** What was last sent, so position reports don't resend it. */
  let sent: { readonly itemId: string | null; readonly text: AutoLyricsText | null } | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;

  const load = (itemId: string): void => {
    const path = ports.pathOf(itemId);
    // Not queued yet (a resumed queue JS hasn't taken over): the next report tries again.
    if (path === null) return;
    loaded = { itemId, lyrics: null };
    ports
      .readLyrics(path)
      // A file that can't be read (or a streamed song, which has no file) has no lyrics to show.
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
    const { text, nextChangeMs } = autoLyricLines({ ...toggle, lyrics, positionMs });
    if (sent?.itemId !== itemId || !sameText(sent.text, text)) {
      sent = { itemId, text };
      ports.show(itemId, text);
    }
    if (state.isPlaying && nextChangeMs !== null) {
      timer = setTimeout(update, Math.max(0, nextChangeMs - positionMs));
    }
  };

  let unsubscribe: (() => void) | undefined;

  return {
    setToggle: (next) => {
      if (stopped) return;
      toggle = next;
      if (toggle.on && toggle.carConnected) {
        unsubscribe ??= ports.playback.subscribe(update);
      } else {
        unsubscribe?.();
        unsubscribe = undefined;
      }
      // The native side drops its lyrics when either turns off; send them afresh.
      sent = null;
      update();
    },
    stop: () => {
      stopped = true;
      unsubscribe?.();
      unsubscribe = undefined;
      if (timer !== null) clearTimeout(timer);
      timer = null;
    },
  };
};
