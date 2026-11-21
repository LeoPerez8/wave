import {
  EMPTY_FRAME_TALLY,
  effectsVerdict,
  phoneEffectsLine,
  readEffectsVerdict,
  sessionEffects,
  tallyFrames,
  writeEffectsVerdict,
  type FrameTally,
  type PhoneEffects,
  type SessionEffects,
} from "@wave/core";
import { Storage } from "expo-sqlite/kv-store";
import { Platform } from "react-native";

import { afterFirstSettled } from "@/lib/backgroundWork";
import { appLog } from "@/log/appLog";
import { registerPerfMeta } from "@/perf/perf";

import { WaveGlass } from "./waveGlass";

/**
 * Weak phones get simpler heavy effects (docs/spec.md › Fluidity, #1357).
 * This session's effects are fixed at start from the verdict the phone's own
 * frame times gave last time (Core's `sessionEffects`), so nothing changes look
 * mid-session. A session drawing the full effects measures: once startup has
 * settled, the frame meter's windows are tallied until Core can judge them,
 * and the verdict is kept for the next start.
 */

/** The key-value store's key for the last verdict. */
const VERDICT_KEY = "wave.phoneEffects.verdict";
const LOG_TAG = "WaveEffects";

let session: SessionEffects | null = null;

const currentSession = (): SessionEffects => {
  if (session !== null) return session;
  let stored: string | null = null;
  try {
    stored = Storage.getItemSync(VERDICT_KEY);
  } catch {
    stored = null;
  }
  session = sessionEffects(readEffectsVerdict(stored), Date.now());
  return session;
};

/** What this session draws: `full` as designed, `simple` on a phone measured weak. */
export const phoneEffects = (): PhoneEffects => currentSession().effects;

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
