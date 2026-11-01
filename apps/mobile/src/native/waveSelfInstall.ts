import type { InstallAccess } from "@wave/core";
import { NativeModule, requireOptionalNativeModule } from "expo";

type WaveSelfInstallEvents = {
  /** The running APK download has reached [percent], at each whole percent. */
  onApkDownloadProgress: (event: { percent: number }) => void;
  /** Android turned down an install it had taken, and the APK is gone. */
  onInstallRefused: () => void;
  /** Android let go of an install and the APK is still there; [failed] if the person wasn't asked. */
  onInstallAbandoned: (event: { failed: boolean }) => void;
};

declare class WaveSelfInstallModule extends NativeModule<WaveSelfInstallEvents> {
  /** What installing an APK takes on this phone right now. */
  installAccess(): Promise<InstallAccess>;
  /** Whether Android counts the network as metered, which a metered Wi-Fi is too. */
  networkIsMetered(): Promise<boolean>;
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
   * Fetches the APK, keeping a whole one already there. Fails on a metered network unless
   * [allowMetered] says the person allowed it, and answers false when what came isn't the signed
   * file.
   */
  downloadApk(
    url: string,
    version: string,
    size: number,
    sha256: string,
    allowMetered: boolean,
  ): Promise<boolean>;
  /**
   * Hands the APK to Android, once its SHA-256 matches. Its answer reaches the app log; on success
   * this process is gone.
   */
  install(version: string, sha256: string): Promise<void>;
}

/** Native updates (`SelfInstaller.kt`). Null in a build without them. */
export const WaveSelfInstall =
  requireOptionalNativeModule<WaveSelfInstallModule>("WaveSelfInstall");
