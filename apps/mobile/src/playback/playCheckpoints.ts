import type { ExternalStore } from "../lib/externalStore.ts";

/**
 * Calls [save] every [intervalMs] while playing, without periodic native
 * position reports: an ongoing listen, the queue's place.
 */
export const observePlayCheckpoints = (
  playback: Pick<ExternalStore<{ readonly isPlaying: boolean }>, "get" | "subscribe">,
  save: () => void,
  intervalMs = 15_000,
): (() => void) => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const checkpoint = (): void => {
    timer = undefined;
    if (!playback.get().isPlaying) return;
    save();
    update();
  };
  const update = (): void => {
    if (!playback.get().isPlaying) {
      clearTimeout(timer);
      timer = undefined;
    } else if (timer === undefined) {
      timer = setTimeout(checkpoint, intervalMs);
    }
  };
  const unsubscribe = playback.subscribe(update);
  update();
  return () => {
    unsubscribe();
    clearTimeout(timer);
    timer = undefined;
  };
};
