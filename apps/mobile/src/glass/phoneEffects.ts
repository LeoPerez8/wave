import {
  EMPTY_FRAME_TALLY,
  effectsVerdict,
  ownerFullEffects,
  phoneEffectsLine,
  readEffectsVerdict,
  readFullGlassChoice,
  sessionEffects,
  tallyFrames,
  writeEffectsVerdict,
  writeFullGlassChoice,
  type FrameTally,
  type PhoneEffects,
  type SessionEffects,
} from "@wave/core";
import { Storage } from "expo-sqlite/kv-store";
import { useSyncExternalStore } from "react";
import { Platform } from "react-native";

import { afterFirstSettled } from "@/lib/backgroundWork";
import { appLog } from "@/log/appLog";
import { registerPerfMeta } from "@/perf/perf";

import { WaveGlass } from "./waveGlass";

/**
 * Weak phones get simpler heavy effects (docs/spec.md › Fluidity, #1357).
 * This session's effects are fixed at start from the verdict the phone's own
 * frame times gave last time (Core's `sessionEffects`), so Wave's verdict never
 * changes look mid-session. A session drawing the full effects measures: once
 * startup has settled, the frame meter's windows are tallied until Core can
 * judge them, and the verdict is kept for the next start. Over a weak verdict
 * the owner's Full glass (Settings › Appearance, #1538) draws the full effects
 * at once and on every start, measuring nothing; it's kept on this phone only.
 */

/** The key-value store's key for the last verdict. */
const VERDICT_KEY = "wave.phoneEffects.verdict";
/** The key-value store's key for the owner's Full glass; not a synced setting. */
const FULL_GLASS_KEY = "wave.phoneEffects.fullGlass";
const LOG_TAG = "WaveEffects";

let session: SessionEffects | null = null;
const listeners = new Set<() => void>();

const storedItem = (key: string): string | null => {
  try {
    return Storage.getItemSync(key);
  } catch {
    return null;
  }
};

const currentSession = (): SessionEffects => {
  session ??= sessionEffects(
    readEffectsVerdict(storedItem(VERDICT_KEY)),
    Date.now(),
    readFullGlassChoice(storedItem(FULL_GLASS_KEY)),
  );
  return session;
};

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/** What this session draws now: `full` as designed, `simple` on a phone measured weak. */
export const phoneEffects = (): PhoneEffects => currentSession().effects;

/** This session's effects; re-renders when the owner turns Full glass on or off. */
export const usePhoneEffectsSession = (): SessionEffects =>
  useSyncExternalStore(subscribe, currentSession);

/** What this session draws; re-renders when the owner turns Full glass on or off. */
export const usePhoneEffects = (): PhoneEffects => usePhoneEffectsSession().effects;

/**
 * Turns the owner's Full glass on or off: kept on this phone at once, and the
 * glass everywhere follows at once. Off goes back to the verdict (simplified),
 * whose re-check the next start runs as before.
 */
export const setFullGlass = (on: boolean): void => {
  const current = currentSession();
  const next = ownerFullEffects(current, on);
  if (next === current || next.ownerFull === current.ownerFull) return;
  try {
    const stored = writeFullGlassChoice(on);
    if (stored === null) Storage.removeItemSync(FULL_GLASS_KEY);
    else Storage.setItemSync(FULL_GLASS_KEY, stored);
  } catch (cause) {
    appLog("warn", LOG_TAG, `Full glass not kept: ${String(cause)}`);
  }
  session = next;
  appLog("info", LOG_TAG, phoneEffectsLine(next, Date.now()));
  for (const listener of listeners) listener();
};

/** Tallies the frame meter's windows until they can be judged, then keeps the verdict. */
const measureFrames = (): (() => void) => {
  let tally: FrameTally = EMPTY_FRAME_TALLY;
  let done = false;
  const subscription = WaveGlass.addListener("onFrameStats", (stats) => {
    if (done) return;
    tally = tallyFrames(tally, stats);
    const verdict = effectsVerdict(tally, Date.now());
    if (verdict === null) return;
    stop();
    Storage.setItem(VERDICT_KEY, writeEffectsVerdict(verdict)).catch((cause: unknown) =>
      appLog("warn", LOG_TAG, `Phone effects verdict not kept: ${String(cause)}`),
    );
    appLog(
      "info",
      LOG_TAG,
      `Phone effects measured: ${verdict.effects} from the next start (${verdict.slow} of ${verdict.counted} animated windows slow)`,
    );
  });
  WaveGlass.startFrameStats();
  const stop = (): void => {
    if (done) return;
    done = true;
    subscription.remove();
    WaveGlass.stopFrameStats();
  };
  return stop;
};

let started = false;

/**
 * Logs this session's effects once and, when the session measures, starts the
 * meter after startup settles. Returns what stops the meter.
 */
export const startPhoneEffects = (): (() => void) => {
  const current = currentSession();
  if (!started) {
    started = true;
    appLog("info", LOG_TAG, phoneEffectsLine(current, Date.now()));
  }
  // The frame meter reads Android's FrameMetrics.
  if (!current.measure || Platform.OS !== "android") return () => {};
  let stop: (() => void) | undefined;
  const cancel = afterFirstSettled("phoneEffectsMeter", () => {
    stop = measureFrames();
  });
  return () => {
    cancel();
    stop?.();
  };
};

// A perf run records which effects drew it, so two runs compare like with like.
registerPerfMeta("phoneEffects", () => ({ effects: phoneEffects() }), true);
