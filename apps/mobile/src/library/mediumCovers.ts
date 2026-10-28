import { afterFirstSettled, freeTurn } from "@/lib/backgroundWork";
import { WaveNative } from "@/native/waveNative";

/** Resumes the one-time native migration, one cached image per free turn. */
export const startMediumCovers = (): (() => void) => {
  let cancelled = false;
  const stopStart = afterFirstSettled("mediumCovers", () => {
    void (async () => {
      while (true) {
        await freeTurn();
        if (cancelled || (await WaveNative.backfillMediumCover())) return;
      }
    })().catch(() => {
      // Leave the completion marker unset; the next launch retries disk/decoder failures.
    });
  });
  return () => {
    cancelled = true;
    stopStart();
  };
};
