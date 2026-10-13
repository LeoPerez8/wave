import { NativeModule, requireNativeModule } from "expo";

declare class WaveLibraryLookupModule extends NativeModule<{
  /** Cancel was tapped in the run's notification. */
  onCancel: () => void;
}> {
  /** The run started: shows its progress notification and keeps Wave running until `end`. */
  start(title: string, detail: string | null): void;
  /** How far the run is: [done] of [total] songs, said as [title] and [detail]. */
  progress(title: string, detail: string | null, done: number, total: number): void;
  /** The run ended: stops the service; a summary (title and message) is shown in a notification. */
  end(title: string | null, message: string | null): void;
  /** Takes the summary notification away once the owner has seen the summary in Wave. */
  dismissSummary(): void;
}

/**
 * The whole-Library lyrics and genre run's foreground service and notification
 * (`modules/wave-native`, `LibraryLookupService`). It also holds the
 * `WaveLibraryLookup` headless task while the run goes on, so JS timers keep
 * running with Wave in the background.
 */
export const WaveLibraryLookup = requireNativeModule<WaveLibraryLookupModule>("WaveLibraryLookup");

/** The headless task native holds while the run goes on; JS registers it. */
export const LIBRARY_LOOKUP_TASK = "WaveLibraryLookup";
