import { NativeModule, requireNativeModule } from "expo";

/** One audio file as read by the native scanner (`modules/wave-native`). Tag values are raw. */
export interface NativeScannedTrack {
  readonly path: string;
  readonly sizeBytes: number;
  readonly modifiedAt: number;
  readonly title: string | null;
  readonly artist: string | null;
  readonly album: string | null;
  readonly albumArtist: string | null;
  readonly genre: string | null;
  readonly year: string | null;
  readonly trackNumber: string | null;
  readonly discNumber: string | null;
  readonly compilation: boolean;
  readonly durationMs: number;
  readonly sampleRate: number | null;
  readonly bitrateKbps: number | null;
  readonly artworkHash: string | null;
}

/** Colours picked from an artwork, as signed ARGB ints. */
export interface NativeArtworkPalette {
  readonly dominant: number | null;
  readonly vibrant: number | null;
  readonly darkVibrant: number | null;
  readonly lightVibrant: number | null;
  readonly muted: number | null;
  readonly darkMuted: number | null;
  readonly lightMuted: number | null;
}

export interface NativeArtwork {
  readonly hash: string;
  readonly path: string;
  readonly thumbPath: string;
  readonly palette: NativeArtworkPalette;
}

export interface ScanProgressEvent {
  readonly scanId: number;
  readonly phase: "discovering" | "reading";
  readonly filesFound: number;
  readonly filesRead: number;
}

export interface ScanBatchEvent {
  readonly scanId: number;
  readonly tracks: readonly NativeScannedTrack[];
  /** Artwork first referenced by this batch; each unique image is sent once per scan. */
  readonly artwork: readonly NativeArtwork[];
}

export interface ScanCompleteEvent {
  readonly scanId: number;
  readonly filesFound: number;
  readonly filesRead: number;
  readonly cancelled: boolean;
  readonly durationMs: number;
}

export interface ScanErrorEvent {
  readonly scanId: number;
  readonly message: string;
}

/** The outcome of the system folder picker. */
export type FolderPick =
  | { readonly status: "picked"; readonly path: string }
  | { readonly status: "cancelled" }
  /** A folder without a file path, such as the Downloads shortcut or a cloud drive. */
  | { readonly status: "unsupported" };

type WaveNativeEvents = {
  onScanProgress: (event: ScanProgressEvent) => void;
  onScanBatch: (event: ScanBatchEvent) => void;
  onScanComplete: (event: ScanCompleteEvent) => void;
  onScanError: (event: ScanErrorEvent) => void;
};

declare class WaveNativeModule extends NativeModule<WaveNativeEvents> {
  /** Whether Wave holds "All files access" (MANAGE_EXTERNAL_STORAGE). */
  hasAllFilesAccess(): boolean;
  /** Opens the system settings screen where the user grants all-files access. */
  requestAllFilesAccess(): Promise<void>;
  /** Absolute path of the shared `Music` folder. */
  getDefaultMusicFolder(): string;
  /** Opens the system folder picker and resolves the picked folder's absolute path. */
  pickFolder(): Promise<FolderPick>;
  /** Starts a full scan, cancelling any running one, and returns its id. */
  startScan(roots: readonly string[], excluded: readonly string[]): number;
  cancelScan(scanId: number): void;
}

export const WaveNative = requireNativeModule<WaveNativeModule>("WaveNative");

/** Converts a signed ARGB int from Android into a `#rrggbb` CSS colour. */
export const argbToHex = (argb: number): string =>
  `#${((argb >>> 0) & 0xffffff).toString(16).padStart(6, "0")}`;
