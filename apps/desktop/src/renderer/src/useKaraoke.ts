/**
 * Karaoke in the Lyrics view (docs/spec.md, "Karaoke"): one switch for the side panel and Now
 * Playing, kept by main on this computer, and when the lyrics move on their own. Core decides
 * both: `lyricsFollowStep` says when they move, and this puts the sung line in its place.
 */
import { lyricsFollowStart, lyricsFollowStep, type LyricsFollowEvent } from "@wave/core";
import { useCallback, useEffect, useLayoutEffect, useRef, useSyncExternalStore } from "react";

import { scrollToRow } from "./rovingList.ts";

let on = false;
let asked = false;
const listeners = new Set<() => void>();
const show = (value: boolean) => {
  on = value;
  for (const listener of listeners) listener();
};
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  if (!asked) {
    asked = true;
    void window.wave.lyrics.karaokeOn().then(show, () => {});
  }
  return () => listeners.delete(listener);
};

/** Whether Karaoke is on, and the button's press; off until main has answered. */
export function useKaraokeOn(): readonly [boolean, (value: boolean) => void] {
  const value = useSyncExternalStore(subscribe, () => on);
  return [
    value,
    (next) => {
      show(next);
      void window.wave.lyrics.setKaraokeOn(next).then(show, () => show(!next));
    },
  ];
}

/** How long after the last scroll by hand the lyrics follow the song again. */
const RESUME_FOLLOW_MS = 3000;

const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * Moves the lyrics in the element holding its `scroll` ref as Core's follow rules say: the sung
 * line ([current], the row with that `data-line`) is placed once when they open, and from then
 * on they move only with [karaoke] on. [held] keeps them still (the keyboard is on a line). Unsynced lyrics
 * ([synced] false) never move. Gives `step`, for what the view itself sees happen (a line
 * clicked; Share's `pickStarted` and `pickEnded`), and `scrolledByHand` for the scroll events.
 */
export function useLyricsFollow({
  current,
  karaoke,
  synced,
  held,
  shown,
}: {
  readonly current: number;
  readonly karaoke: boolean;
  readonly synced: boolean;
  readonly held: boolean;
  /** The view is on screen; lyrics that opened hidden place their line once it shows. */
  readonly shown: boolean;
}) {
  const scroll = useRef<HTMLDivElement>(null);
  const follow = useRef(lyricsFollowStart({ karaoke, picking: false }));
  const resume = useRef<ReturnType<typeof setTimeout>>(undefined);
  const latest = useRef({ current, held, synced });
  useLayoutEffect(() => {
    latest.current = { current, held, synced };
  });

  const step = useCallback((event: LyricsFollowEvent, line?: number) => {
    const { state, move } = lyricsFollowStep(follow.current, event);
    follow.current = state;
    const element = scroll.current;
    if (move === "stay" || !latest.current.synced || latest.current.held) return;
    // Hidden lyrics have no size to scroll in: the line is placed once they show.
    if (element === null || element.clientHeight === 0) return;
    const at = line ?? latest.current.current;
    const row = element.querySelector<HTMLElement>(`[data-line="${at}"]`);
    const behavior = move === "slide" && !reducedMotion() ? "smooth" : "auto";
    // Before the first line the lyrics rest at their top.
    if (row === null) element.scrollTo({ top: 0, behavior });
    else scrollToRow(element, row, true, behavior);
    if (move === "place") follow.current = lyricsFollowStep(state, "placed").state;
  }, []);

  const stopResume = useCallback(() => {
    clearTimeout(resume.current);
    resume.current = undefined;
  }, []);
  useEffect(() => stopResume, [stopResume]);

  // The lines laid out, or changed height (a translation arrived, the window resized).
  useLayoutEffect(() => {
    const lines = scroll.current?.querySelector(".lyric-lines");
    if (!lines) return;
    const observer = new ResizeObserver(() => step("laidOut"));
    observer.observe(lines);
    return () => observer.disconnect();
  }, [step]);

  const line = useRef(current);
  useEffect(() => {
    if (line.current === current) return;
    line.current = current;
    step("lineChanged");
  }, [current, step]);

  // After the sung line's update above: turning Karaoke on goes to that line.
  useEffect(() => {
    if (follow.current.karaoke === karaoke) return;
    stopResume();
    step(karaoke ? "karaokeOn" : "karaokeOff");
  }, [karaoke, step, stopResume]);

  const wasShown = useRef(shown);
  useEffect(() => {
    if (wasShown.current === shown) return;
    wasShown.current = shown;
    if (!shown) stopResume();
    step(shown ? "shown" : "hidden");
  }, [shown, step, stopResume]);

  return {
    /** The scrolling element's ref. */
    scroll,
    /** A line was clicked (or Enter on it): with Karaoke on it comes to rest. */
    lineTapped: (index: number) => {
      stopResume();
      step("lineTapped", index);
    },
    /** The wheel, a touch or the scrollbar moved the lyrics: they stay put for 3 seconds. */
    scrolledByHand: () => {
      stopResume();
      step("fingerDown");
      resume.current = setTimeout(() => {
        resume.current = undefined;
        step("resumeDue");
      }, RESUME_FOLLOW_MS);
    },
    /** The lyrics scrolled: a scroll still going by hand pushes the wait back. */
    scrolled: () => {
      if (resume.current === undefined) return;
      clearTimeout(resume.current);
      resume.current = setTimeout(() => {
        resume.current = undefined;
        step("resumeDue");
      }, RESUME_FOLLOW_MS);
    },
    step,
  };
}
