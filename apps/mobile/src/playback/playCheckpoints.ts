import type { ExternalStore } from "../lib/externalStore.ts";

/** Save ongoing listens without requiring periodic native position reports. */
export const observePlayCheckpoints = (
  playback: Pick<ExternalStore<{ readonly isPlaying: boolean }>, "get" | "subscribe">,
  save: () => void,
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
      timer = setTimeout(checkpoint, 15_000);
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
