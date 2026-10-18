import { persistedSetting } from "@/lib/persistedSetting";

/**
 * Don't play explicit (Settings › Playback), off unless the owner turned it
 * on: the queue passes over explicit songs (Core's `explicitPassOver`) and
 * Discover mixes leave them out (`discoverMixKeep`). Lists still show them.
 */
const dontPlayExplicitSetting = persistedSetting<boolean>({
  key: "settings.dontPlayExplicit",
  synced: true,
  read: (stored) => stored === "on",
  write: (on) => (on ? "on" : null),
  onValue: (on) => listener?.(on),
});

let listener: ((on: boolean) => void) | null = null;

/**
 * Tells [next] each value the switch takes (the queue drops its explicit
 * songs as it turns on), until the returned stop is called.
 */
export const onDontPlayExplicit = (next: (on: boolean) => void): (() => void) => {
  listener = next;
  return () => {
    if (listener === next) listener = null;
  };
};

export const dontPlayExplicit = dontPlayExplicitSetting.get;

export const setDontPlayExplicit = dontPlayExplicitSetting.set;

/** Whether Don't play explicit is on; re-renders when Settings changes it. */
export const useDontPlayExplicit = dontPlayExplicitSetting.useValue;
