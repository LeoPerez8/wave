/**
 * Music through Install Now's reload (docs/spec.md, Over-the-air updates). Playback lives in the
 * native service, so the reload should leave it playing. In case it doesn't, the queue's place is
 * written before the reload, and a mark says music was playing: the next launch reads the mark once
 * and, if the player came back stopped, plays the restored queue (Core's `resumesAfterReload`).
 */
import { persistedSetting } from "@/lib/persistedSetting";

/** The longest the reload waits for the queue's place to be written. */
const SAVE_WAIT_MS = 1000;

/** When a reload began with music playing; null with none. Kept across the reload. */
const playingAtReload = persistedSetting<number | null>({
  key: "updates.playingAtReload",
  read: (stored) => {
    const at = stored === null ? NaN : Number(stored);
    return Number.isFinite(at) ? at : null;
  },
  write: (at) => (at === null ? null : String(at)),
});

let savePlace: (() => Promise<void>) | null = null;

/** How to write the queue's place now (`PlaybackPersistence`); gives the function that stops it. */
export const onSavePlaceForReload = (save: () => Promise<void>): (() => void) => {
  savePlace = save;
  return () => {
    if (savePlace === save) savePlace = null;
  };
};

/** Before the reload: the queue's place written, and whether music was playing kept for the launch. */
export const prepareReload = async ({
  playing,
  now,
}: {
  readonly playing: boolean;
  readonly now: number;
}): Promise<void> => {
  const save = savePlace;
  if (save !== null) {
    await Promise.race([
      save().catch(() => undefined),
      new Promise<void>((resolve) => setTimeout(resolve, SAVE_WAIT_MS)),
    ]);
  }
  playingAtReload.set(playing ? now : null);
};

/** The reload didn't happen, so no later launch should take the mark for it. */
export const reloadFailed = (): void => playingAtReload.set(null);

/** The mark a reload left, cleared: a launch reads it once. */
export const takePlayingAtReload = (): number | null => {
  const at = playingAtReload.get();
  if (at !== null) playingAtReload.set(null);
  return at;
};
