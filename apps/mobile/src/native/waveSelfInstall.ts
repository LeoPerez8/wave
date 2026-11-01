import { NativeModule, requireOptionalNativeModule } from "expo";

declare class WaveSelfInstallModule extends NativeModule {
  /** Logs and returns the phone's state: Android, target SDK, installer of record, permission. */
  report(): string;
  /**
   * Opens the install-from-this-source screen if that's still needed, else downloads `url` and
   * commits it silently. Resolves with what it did; the install's status reaches the app log.
   */
  start(url: string): Promise<string>;
}

/** The self-install spike (#886). Null in a build without it. */
export const WaveSelfInstall =
  requireOptionalNativeModule<WaveSelfInstallModule>("WaveSelfInstall");
