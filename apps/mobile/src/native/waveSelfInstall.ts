import type { InstallAccess } from "@wave/core";
import { NativeModule, requireOptionalNativeModule } from "expo";

declare class WaveSelfInstallModule extends NativeModule {
  /** What installing an APK takes on this phone right now. */
  installAccess(): InstallAccess;
  /** The APK's versionName, whatever bundle is running. */
  installedVersion(): string;
  /** Whether that version's whole APK is already on the phone. */
  hasApk(version: string, size: number): boolean;
  /** Android's "install from this source" screen. */
  openPermissionScreen(): void;
  /** Fetches the APK, keeping a whole one already there. Fails on a metered network. */
  downloadApk(url: string, version: string, size: number): Promise<void>;
  /** Hands the APK to Android. Its answer reaches the app log; on success this process is gone. */
  install(version: string): Promise<void>;
}

/** Native updates (`SelfInstaller.kt`). Null in a build without them. */
export const WaveSelfInstall =
  requireOptionalNativeModule<WaveSelfInstallModule>("WaveSelfInstall");
