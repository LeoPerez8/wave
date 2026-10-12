import { snapSliderValue } from "@wave/core";

import { persistedSetting } from "@/lib/persistedSetting";

/** How long a tap's press animation takes, in milliseconds (0 turns it off). */
export const TAP_ANIMATION = { min: 0, max: 600, step: 20, default: 140 } as const;

const clamp = (ms: number): number => snapSliderValue(ms, TAP_ANIMATION);

const tapAnimation = persistedSetting<number>({
  key: "settings.tapAnimationMs",
  read: (stored) => {
    const ms = stored === null ? Number.NaN : Number(stored);
    return Number.isFinite(ms) ? clamp(ms) : TAP_ANIMATION.default;
  },
  write: String,
});

export const setTapAnimationMs = (ms: number): void => tapAnimation.set(clamp(ms));

/** The persisted tap animation duration; re-renders when Settings changes it. */
export const useTapAnimationMs = tapAnimation.useValue;
