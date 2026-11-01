import type { InstallAccess } from "@wave/core";
import { NativeModule, requireOptionalNativeModule } from "expo";

declare class WaveSelfInstallModule extends NativeModule {
  /** What installing an APK takes on this phone right now. */
  installAccess(): Promise<InstallAccess>;
  /** The APK's versionName, whatever bundle is running. */
  installedVersion(): Promise<string>;
  /** Whether that version's whole APK is already on the phone, going by its size. */
  hasApk(version: string, size: number): Promise<boolean>;
  /** Whether CI signed this metadata, by the certificate this APK checks updates with. */
  checkApkMetadata(
    metadata: string,
    signature: string,
  ): Promise<"valid" | "noCertificate" | "badSignature">;
  /** Android's "install from this source" screen. */
  openPermissionScreen(): void;
  /**
   * Fetches the APK, keeping a whole one already there. Fails on a metered network, and answers
   * false when what came isn't the signed file.
   */
  downloadApk(url: string, version: string, size: number, sha256: string): Promise<boolean>;
  /**
   * Hands the APK to Android, once its SHA-256 matches. Its answer reaches the app log; on success
   * this process is gone.
   */
  install(version: string, sha256: string): Promise<void>;
}

/** Native updates (`SelfInstaller.kt`). Null in a build without them. */
export const WaveSelfInstall =
  requireOptionalNativeModule<WaveSelfInstallModule>("WaveSelfInstall");
