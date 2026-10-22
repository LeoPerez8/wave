import { appLog } from "@/log/appLog";

/** Opt-in threshold investigation; bounded per process, with no touch-move logging. */
const enabled = process.env.EXPO_PUBLIC_WAVE_LONG_PRESS_TRACE === "1";
let remaining = 256;

export const traceLongPress = (key: number, event: string, detail = ""): void => {
  if (!enabled || remaining <= 0) return;
  remaining -= 1;
  appLog("info", "WaveLongPress", `${performance.now().toFixed(1)} key=${key} ${event} ${detail}`);
};
