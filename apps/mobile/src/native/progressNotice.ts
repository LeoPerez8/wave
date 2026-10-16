import { NativeModule } from "expo";

/**
 * A long run's foreground service with a progress notification and Cancel
 * (`modules/wave-native`): the lyrics and genre run's, link imports'. While
 * the run goes on it holds Wave's JS runtime (`JsRuntime`, the `WaveService`
 * headless task), so JS timers keep running with Wave in the background.
 */
declare class ProgressNotice extends NativeModule<{
  /** Cancel was tapped in the notification. */
  onCancel: () => void;
}> {
  /** The run started: shows its progress notification and keeps Wave running until it ends. */
  start(title: string, detail: string | null): void;
  /** How far the run is: [done] of [total] songs, said as [title] and [detail]. */
  progress(title: string, detail: string | null, done: number, total: number): void;
}

export type ProgressNoticeModule = ProgressNotice;
