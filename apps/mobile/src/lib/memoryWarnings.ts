import { WaveAppLog } from "../native/waveAppLog.ts";

/**
 * Calls `listener` at each of Android's memory warnings (`log/MemoryWarnings.kt`, the same event
 * that writes the app log at once). A build without the native module never warns. Returns the
 * unsubscribe.
 */
export const onMemoryWarning = (listener: () => void): (() => void) => {
  const subscription = WaveAppLog?.addListener("memoryWarning", listener);
  return () => subscription?.remove();
};
