import { NativeModule, requireNativeModule } from "expo";

declare class WavePlaylistImportModule extends NativeModule<{
  /** Cancel was tapped in the import's notification. */
  onCancel: () => void;
}> {
  /** Imports started: shows their progress notification and keeps Wave running until `end`. */
  start(title: string, detail: string | null): void;
  /** How far the import going on is: [done] of [total] songs, said as [title] and [detail]. */
  progress(title: string, detail: string | null, done: number, total: number): void;
  /** No import is going on any more: stops the service and takes the notification away. */
  end(): void;
}

/**
 * Link imports' foreground service and notification (`modules/wave-native`,
 * `PlaylistImportService`). While an import goes on it also holds Wave's JS
 * runtime (`JsRuntime`, the `WaveService` headless task), so JS timers keep
 * running with Wave in the background.
 */
export const WavePlaylistImport =
  requireNativeModule<WavePlaylistImportModule>("WavePlaylistImport");
